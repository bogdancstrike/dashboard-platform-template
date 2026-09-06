"""Creating, editing and deleting a record (§9, §73).

These run against the seeded database, so they are careful with it: every test
works on a scratch record it created and soft-deletes on the way out, and the
one test that edits nothing puts back what it changed. A suite that leaves the
demo dataset a little different each run is a suite that makes the Playwright
numbers drift for reasons nobody can find.

What is asserted is mostly the *declaration*: that the API accepts exactly the
fields the resource says a form may write, refuses the vocabulary it does not
declare, and writes an audit row in the same transaction as the change.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from sqlalchemy import select

from src.config import Config
from tests.conftest import persona_claims

PREFIX = Config.API_PREFIX
TASKS = f"{PREFIX}/api/records/task"


def _authenticate(monkeypatch, username: str = "admin", role: str = "administrator"):
    monkeypatch.setattr(
        "src.core.auth.verify_token",
        lambda _token: persona_claims(username, role, sid=f"writes-{username}"),
    )
    return {"Authorization": f"Bearer writes-{username}"}


def _erase(record_id: str) -> None:
    """Take a scratch record out of the dataset for good.

    A hard delete rather than the API's soft one: a soft-deleted row still
    occupies its `reference`, and a suite that runs fifty times leaves fifty
    invisible tasks behind.
    """
    from src.core.db import session_scope
    from src.models.business import Task
    from src.models.platform import ActivityEntry

    with session_scope() as session:
        session.query(ActivityEntry).filter(
            ActivityEntry.resource_type == "task",
            ActivityEntry.resource_id == str(record_id),
        ).delete(synchronize_session=False)
        session.query(Task).filter(Task.id == record_id).delete(synchronize_session=False)


@pytest.fixture()
def scratch_task(client, monkeypatch):
    """A task this test owns, created through the API and removed afterwards."""
    headers = _authenticate(monkeypatch)
    response = client.post(
        TASKS, json={"title": "Scratch task", "status": "NEW", "priority": "HIGH"},
        headers=headers,
    )
    assert response.status_code == 201, response.get_json()
    record = response.get_json()
    try:
        yield record
    finally:
        _erase(record["id"])


# ── the five cases every endpoint answers ────────────────────────────────


def test_writing_a_record_needs_a_bearer_token(client):
    assert client.post(TASKS, json={"title": "x"}).status_code == 401
    assert client.put(f"{TASKS}/{uuid4()}", json={"status": "DONE"}).status_code == 401
    assert client.delete(f"{TASKS}/{uuid4()}").status_code == 401


@pytest.mark.database
def test_reading_a_record_does_not_carry_the_right_to_change_it(client, monkeypatch, scratch_task):
    # An analyst may read every record and write none of them, and is told
    # which permission is missing rather than which route to use (§76).
    _authenticate(monkeypatch, "analyst", "analyst")
    headers = {"Authorization": "Bearer writes-analyst"}

    assert client.get(f"{TASKS}/{scratch_task['id']}", headers=headers).status_code == 200
    refused = client.put(f"{TASKS}/{scratch_task['id']}", json={"status": "DONE"}, headers=headers)

    assert refused.status_code == 403
    assert refused.get_json()["details"]["missing"] == ["records.update"]


@pytest.mark.database
def test_editing_a_record_that_does_not_exist_is_a_404(client, monkeypatch):
    response = client.put(
        f"{TASKS}/{uuid4()}", json={"status": "DONE"}, headers=_authenticate(monkeypatch)
    )
    assert response.status_code == 404


@pytest.mark.database
def test_a_field_the_declaration_does_not_publish_cannot_be_written(client, monkeypatch, scratch_task):
    # Silently ignoring an unknown key is how a form that posts `assignee`
    # where the field is `assignee_id` appears to save and changes nothing.
    response = client.put(
        f"{TASKS}/{scratch_task['id']}",
        json={"reference": "TSK-00001", "board_position": 3},
        headers=_authenticate(monkeypatch),
    )

    assert response.status_code == 400
    assert response.get_json()["details"]["fields"] == ["board_position", "reference"]


@pytest.mark.database
def test_an_edit_moves_the_record_and_says_so(client, monkeypatch, scratch_task):
    response = client.put(
        f"{TASKS}/{scratch_task['id']}",
        json={"status": "IN_PROGRESS", "progress": 40},
        headers=_authenticate(monkeypatch),
    )

    assert response.status_code == 200
    body = response.get_json()
    assert body["status"] == "IN_PROGRESS"
    assert _field(body, "progress") == 40


# ── the declaration is the contract ──────────────────────────────────────


@pytest.mark.database
def test_the_detail_publishes_which_fields_a_form_may_write(client, monkeypatch, scratch_task):
    from src.services.explorer import resources

    body = client.get(
        f"{TASKS}/{scratch_task['id']}", headers=_authenticate(monkeypatch)
    ).get_json()

    editable = {field["name"] for field in body["fields"] if field["editable"]}
    assert editable == {spec.name for spec in resources()["task"].editable}
    assert body["can_edit"] is True
    # The bounds a form enforces are the bounds the API enforces, because they
    # are the same declaration.
    progress = next(field for field in body["fields"] if field["name"] == "progress")
    assert (progress["minimum"], progress["maximum"]) == (0, 100)


@pytest.mark.database
def test_a_value_outside_the_declared_bounds_is_refused_with_the_bounds(client, monkeypatch, scratch_task):
    response = client.put(
        f"{TASKS}/{scratch_task['id']}", json={"progress": 400},
        headers=_authenticate(monkeypatch),
    )

    assert response.status_code == 400
    assert response.get_json()["details"]["maximum"] == 100


@pytest.mark.database
def test_a_status_outside_the_vocabulary_is_refused_and_the_vocabulary_named(client, monkeypatch, scratch_task):
    from src.core import vocabulary

    response = client.put(
        f"{TASKS}/{scratch_task['id']}", json={"status": "ALMOST_DONE"},
        headers=_authenticate(monkeypatch),
    )

    assert response.status_code == 400
    assert response.get_json()["details"]["allowed"] == list(vocabulary.TASK_STATUS)


@pytest.mark.database
def test_a_foreign_key_that_points_nowhere_is_a_client_error_not_a_500(client, monkeypatch, scratch_task):
    # Checked before the INSERT, against the table the column's own ForeignKey
    # names — so a dangling id is a 404 about the assignee rather than an
    # IntegrityError surfacing as a 500.
    response = client.put(
        f"{TASKS}/{scratch_task['id']}", json={"assignee_id": str(uuid4())},
        headers=_authenticate(monkeypatch),
    )

    assert response.status_code == 404
    assert response.get_json()["details"]["field"] == "assignee_id"


@pytest.mark.database
def test_a_real_assignee_is_accepted(client, monkeypatch, scratch_task):
    from src.core.db import session_scope
    from src.models.identity import User

    with session_scope() as session:
        user = session.scalars(select(User).where(User.deleted_at.is_(None)).limit(1)).one()

    body = client.put(
        f"{TASKS}/{scratch_task['id']}", json={"assignee_id": str(user.id)},
        headers=_authenticate(monkeypatch),
    ).get_json()

    assert _field(body, "assignee_id") == str(user.id)


# ── created records ──────────────────────────────────────────────────────


@pytest.mark.database
def test_a_created_record_is_named_by_the_server_in_the_seeded_shape(scratch_task):
    # `TSK-00042`, like every other task — a dataset that visibly splits into
    # "the seeded ones" and "the ones somebody made" is not a demo.
    assert scratch_task["subtitle"].startswith("TSK-")
    assert len(scratch_task["subtitle"]) == len("TSK-00001")


@pytest.mark.database
def test_a_client_cannot_choose_the_identifier(client, monkeypatch):
    response = client.post(
        TASKS, json={"title": "Mine", "reference": "TSK-00001"},
        headers=_authenticate(monkeypatch),
    )

    assert response.status_code == 400
    assert response.get_json()["details"]["fields"] == ["reference"]


@pytest.mark.database
def test_creating_without_a_required_field_says_which_one(client, monkeypatch):
    response = client.post(TASKS, json={"status": "NEW"}, headers=_authenticate(monkeypatch))

    assert response.status_code == 400
    assert response.get_json()["details"]["field"] == "title"


@pytest.mark.database
def test_creating_needs_its_own_permission(client, monkeypatch):
    _authenticate(monkeypatch, "analyst", "analyst")
    response = client.post(
        TASKS, json={"title": "Not mine"}, headers={"Authorization": "Bearer writes-analyst"}
    )

    assert response.status_code == 403
    assert response.get_json()["details"]["missing"] == ["records.create"]


# ── concurrency, deletion and the audit trail ────────────────────────────


@pytest.mark.database
def test_an_edit_written_against_a_stale_version_is_refused(client, monkeypatch, scratch_task):
    headers = _authenticate(monkeypatch)
    stale = (datetime.now(UTC) - timedelta(hours=1)).isoformat()

    response = client.put(
        f"{TASKS}/{scratch_task['id']}",
        json={"status": "DONE", "expected_updated_at": stale},
        headers=headers,
    )

    assert response.status_code == 409
    assert response.get_json()["details"]["expected"].startswith(stale[:16])
    # And the version it was actually written against goes through.
    fresh = client.get(f"{TASKS}/{scratch_task['id']}", headers=headers).get_json()
    accepted = client.put(
        f"{TASKS}/{scratch_task['id']}",
        json={"status": "DONE", "expected_updated_at": fresh["updated_at"]},
        headers=headers,
    )
    assert accepted.status_code == 200


@pytest.mark.database
def test_a_deleted_record_is_gone_from_the_list_and_from_its_own_address(client, monkeypatch, scratch_task):
    headers = _authenticate(monkeypatch)

    assert client.delete(f"{TASKS}/{scratch_task['id']}", headers=headers).status_code == 200
    assert client.get(f"{TASKS}/{scratch_task['id']}", headers=headers).status_code == 404

    listed = client.post(
        f"{PREFIX}/api/explorer/query",
        json={"resource_type": "task", "filters": {"title": "Scratch task"}},
        headers=headers,
    ).get_json()
    assert all(item["id"] != scratch_task["id"] for item in listed["items"])


@pytest.mark.database
def test_deleting_needs_its_own_permission(client, monkeypatch, scratch_task):
    _authenticate(monkeypatch, "operator", "operator")
    response = client.delete(
        f"{TASKS}/{scratch_task['id']}", headers={"Authorization": "Bearer writes-operator"}
    )

    # An operator works the queue and may edit a record; removing one is a
    # different act and a different permission.
    assert response.status_code == 403
    assert response.get_json()["details"]["missing"] == ["records.delete"]


@pytest.mark.database
def test_a_lane_change_is_audited_as_a_status_change_with_both_sides(client, monkeypatch, scratch_task):
    headers = _authenticate(monkeypatch)
    client.put(f"{TASKS}/{scratch_task['id']}", json={"status": "IN_PROGRESS"}, headers=headers)

    timeline = client.get(
        f"{PREFIX}/api/audit/timeline?resource_type=task&resource_id={scratch_task['id']}",
        headers=headers,
    ).get_json()

    moved = next(entry for entry in timeline["items"] if entry["action"] == "STATUS_CHANGE")
    change = next(item for item in moved["changes"] if item["field"] == "status")
    assert (change["from"], change["to"]) == ("NEW", "IN_PROGRESS")
    assert "IN_PROGRESS" in moved["message"]
    # And the creation is on the same timeline, so a record's history starts
    # where the record does.
    assert any(entry["action"] == "CREATE" for entry in timeline["items"])


def _field(body: dict, name: str):
    return next(field["value"] for field in body["fields"] if field["name"] == name)
