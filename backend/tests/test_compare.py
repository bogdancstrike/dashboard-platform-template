"""Two or more records side by side (§47).

The claims worth asserting:

**The fields that are the same are returned too.** They are the evidence that
two records are the same thing, which is the commonest reason anybody opens
this view — a comparison that only ever shows differences cannot answer "are
these duplicates".

**`differs` is computed on the value the page draws.** Comparing the ORM
attributes would let two records look identical on screen and be marked
different: `Decimal("10.00")` and `Decimal("10.0")` are not equal in Python and
are the same money.

**The order is the reader's.** A comparison whose columns arrive in database
order is one somebody has to re-find their place in.

**The refusals name the numbers.** Fewer than two is the detail page; more than
five is a table nobody can compare anything in.
"""

from __future__ import annotations

from uuid import uuid4

import pytest

from src.config import Config
from src.services import compare as service
from tests.conftest import persona_claims

PREFIX = Config.API_PREFIX
TASKS = f"{PREFIX}/api/records/task"
COMPARE = f"{TASKS}/compare"


def _authenticate(monkeypatch, username: str = "admin", role: str = "administrator"):
    monkeypatch.setattr(
        "src.core.auth.verify_token",
        lambda _token: persona_claims(username, role, sid=f"compare-{username}"),
    )
    return {"Authorization": f"Bearer compare-{username}"}


def _erase(ids: list[str]) -> None:
    from src.core.db import session_scope
    from src.models.business import Task
    from src.models.platform import ActivityEntry, AuditLog

    with session_scope() as session:
        for record_id in ids:
            session.query(ActivityEntry).filter(
                ActivityEntry.resource_id == str(record_id)
            ).delete(synchronize_session=False)
            session.query(AuditLog).filter(
                AuditLog.resource_id == str(record_id)
            ).delete(synchronize_session=False)
            session.query(Task).filter(Task.id == record_id).delete(synchronize_session=False)


@pytest.fixture()
def pair(client, monkeypatch):
    """Two tasks that agree about one field and disagree about another."""
    headers = _authenticate(monkeypatch)
    made = []
    for status in ("NEW", "IN_PROGRESS"):
        response = client.post(
            TASKS,
            json={"title": "Compare probe", "status": status, "priority": "HIGH"},
            headers=headers,
        )
        assert response.status_code == 201, response.get_json()
        made.append(response.get_json()["id"])
    try:
        yield made
    finally:
        _erase(made)


def test_a_comparison_needs_a_bearer_token(client):
    assert client.get(f"{COMPARE}?ids={uuid4()},{uuid4()}").status_code == 401


@pytest.mark.database
def test_it_returns_the_fields_that_agree_as_well(client, monkeypatch, pair):
    body = client.get(
        f"{COMPARE}?ids={','.join(pair)}", headers=_authenticate(monkeypatch)
    ).get_json()

    by_name = {row["name"]: row for row in body["fields"]}
    # The pair share a title and a priority and differ on status — and all
    # three are here, because the fields that match are the evidence that two
    # records are the same thing.
    assert by_name["title"]["differs"] is False
    assert by_name["priority"]["differs"] is False
    assert by_name["status"]["differs"] is True
    assert body["differing"] >= 1
    assert body["same"] >= 2
    assert body["differing"] + body["same"] == len(body["fields"])


@pytest.mark.database
def test_the_id_is_not_a_difference_worth_showing(client, monkeypatch, pair):
    body = client.get(
        f"{COMPARE}?ids={','.join(pair)}", headers=_authenticate(monkeypatch)
    ).get_json()
    # The one field guaranteed to differ and guaranteed not to matter.
    assert "id" not in {row["name"] for row in body["fields"]}


@pytest.mark.database
def test_the_columns_are_in_the_order_they_were_asked_for(client, monkeypatch, pair):
    headers = _authenticate(monkeypatch)
    forwards = client.get(f"{COMPARE}?ids={pair[0]},{pair[1]}", headers=headers).get_json()
    backwards = client.get(f"{COMPARE}?ids={pair[1]},{pair[0]}", headers=headers).get_json()

    # A comparison whose columns arrive in database order is one the reader has
    # to re-find their place in.
    assert [record["id"] for record in forwards["records"]] == pair
    assert [record["id"] for record in backwards["records"]] == list(reversed(pair))


@pytest.mark.database
def test_one_record_named_twice_is_not_compared_with_itself(client, monkeypatch, pair):
    headers = _authenticate(monkeypatch)
    body = client.get(
        f"{COMPARE}?ids={pair[0]},{pair[1]},{pair[0]}", headers=headers
    ).get_json()
    # De-duplicated rather than refused: otherwise the table would show nothing
    # differing and nothing wrong.
    assert len(body["records"]) == 2


@pytest.mark.database
def test_fewer_than_two_is_refused_by_name(client, monkeypatch, pair):
    headers = _authenticate(monkeypatch)
    for query in (f"?ids={pair[0]}", "?ids=", ""):
        response = client.get(f"{COMPARE}{query}", headers=headers)
        assert response.status_code == 400, query
        # One record compared with nothing is the detail page, and answering it
        # here would be a second, worse detail page.
        assert response.get_json()["details"]["minimum"] == service.MIN_RECORDS


@pytest.mark.database
def test_more_than_the_cap_is_refused_with_both_numbers(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    ids = ",".join(str(uuid4()) for _ in range(service.MAX_RECORDS + 2))
    response = client.get(f"{COMPARE}?ids={ids}", headers=headers)

    assert response.status_code == 400
    # Both numbers, so the reader can narrow rather than guess.
    assert response.get_json()["details"] == {
        "ids": service.MAX_RECORDS + 2,
        "limit": service.MAX_RECORDS,
    }


@pytest.mark.database
def test_a_record_that_has_gone_is_named_rather_than_dropped(client, monkeypatch, pair):
    headers = _authenticate(monkeypatch)
    gone = str(uuid4())
    response = client.get(f"{COMPARE}?ids={pair[0]},{gone}", headers=headers)

    assert response.status_code == 404
    # Named, because "one of these no longer exists" is the answer for a
    # comparison started from a list somebody has since changed. Dropping it
    # silently would compare one record with nothing.
    assert response.get_json()["details"]["missing"] == [gone]


@pytest.mark.database
def test_a_dataset_nobody_publishes_is_refused(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    response = client.get(
        f"{PREFIX}/api/records/nonesuch/compare?ids={uuid4()},{uuid4()}", headers=headers
    )
    assert response.status_code == 400


def test_two_values_that_read_the_same_are_the_same():
    """The comparison is on the value the page draws.

    A pure test because it is the one rule that cannot be seen from a fixture:
    a list from a JSONB column is not hashable, and two lists with the same
    contents have to count as equal or every record with tags would differ from
    every other one.
    """
    assert service._comparable(["a", "b"]) == service._comparable(["a", "b"])
    assert service._comparable({"x": 1}) == service._comparable({"x": 1})
    assert service._comparable(["a"]) != service._comparable(["b"])
