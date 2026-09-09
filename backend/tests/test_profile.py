"""A person's own page, and a colleague's (§40, §41).

The claims worth asserting are all about *who may be told what*, plus one about
the numbers.

**Your own page needs no permission.** A reader with nothing but `records.view`
opens it. That is deliberate and it is the whole point: the page exists to
answer "why can I not export?", and a page that has to be granted is one the
asker cannot reach.

**A colleague's page withholds, and says that it is withholding.** Contact
details and the permission breakdown need `users.view`; the activity trail needs
`audit.view`, because a per-person list of everything somebody did is exactly
what that permission gates. `visibility` publishes which of those the reader
has, so the page can name the absence rather than render a blank section.

**The access explanation is the administrator's, not a second opinion.** The
same function computes it for `/admin/users/:id` and for `/profile`, so the two
cannot disagree about what somebody may do.

**Every bucket is present.** The throughput chart has a bar per week and the
heatmap a cell per hour, including the empty ones — a chart drawn only where
there is data reports a quiet week as no week at all.
"""

from __future__ import annotations

from uuid import uuid4

import pytest

from src.config import Config
from src.services import profile as service
from tests.conftest import persona_claims

PREFIX = Config.API_PREFIX
MINE = f"{PREFIX}/api/profile"


def _authenticate(monkeypatch, username: str = "admin", role: str = "administrator"):
    monkeypatch.setattr(
        "src.core.auth.verify_token",
        lambda _token: persona_claims(username, role, sid=f"profile-{username}"),
    )
    return {"Authorization": f"Bearer profile-{username}"}


def _someone_else(client, headers, *, mine_id: str) -> str:
    """Another person's id, from the directory the caller can already read."""
    people = client.get(f"{PREFIX}/api/directory/people", headers=headers).get_json()
    other = next(row for row in people["items"] if row["id"] != mine_id)
    return str(other["id"])


def test_a_profile_needs_a_bearer_token(client):
    assert client.get(MINE).status_code == 401
    assert client.get(f"{MINE}/{uuid4()}").status_code == 401


@pytest.mark.database
def test_your_own_page_needs_no_permission(client, monkeypatch):
    # A viewer holds `records.view` and little else. The page about them is
    # theirs to read, the same way `/settings/security` is (§41).
    headers = _authenticate(monkeypatch, "user", "viewer")
    response = client.get(MINE, headers=headers)

    assert response.status_code == 200
    body = response.get_json()
    assert body["is_me"] is True
    # Their own contact details and their own access, without `users.view`.
    assert body["visibility"] == {"contact": True, "access": True, "activity": True}
    assert body["user"]["email"]
    assert body["access"] is not None


@pytest.mark.database
def test_it_explains_why_the_reader_can_do_what_they_can(client, monkeypatch):
    """The question the page exists to answer.

    Role *plus* groups and the effective set, computed by the same function
    `/admin/users/:id` uses — so a reader looking at themselves and an
    administrator looking at them are told the same thing.
    """
    headers = _authenticate(monkeypatch)
    body = client.get(MINE, headers=headers).get_json()

    access = body["access"]
    assert "records.view" in access["effective"]
    assert access["effective_labels"]
    # The surprising half is named separately: granted by a group rather than
    # by the role.
    assert set(access["from_groups_only"]) <= set(access["effective"])

    # And it is the administrator's own answer, not a second opinion.
    from src.core.db import session_scope
    from src.services import users

    with session_scope() as session:
        person = users.load_person(session, body["user"]["id"])
        assert users.access_of(person) == access


@pytest.mark.database
def test_a_colleague_sees_the_business_card_and_not_the_rest(client, monkeypatch):
    """What a reader without `users.view` is told about somebody else.

    Nothing that is not already on `/admin/users`, which every persona can
    read — and the withholding is *published*, so the page names the absence
    instead of drawing an empty panel (§76).
    """
    headers = _authenticate(monkeypatch, "user", "viewer")
    mine = client.get(MINE, headers=headers).get_json()

    # The viewer role holds `users.view` in this realm, so the permission has
    # to be removed to test the reader who does not.
    monkeypatch.setattr("src.core.auth._permissions_for", lambda *_: {"records.view"})
    other = _authenticate(monkeypatch, "manager", "manager")
    identifier = mine["user"]["id"]
    body = client.get(f"{MINE}/{identifier}", headers=other).get_json()

    assert body["is_me"] is False
    assert body["visibility"] == {"contact": False, "access": False, "activity": False}
    # A name and a role: what appears on a business card.
    assert body["user"]["full_name"]
    assert body["role"]["name"]
    # And not the rest. Absent rather than blank, so a client cannot render an
    # empty string as though it were the person's address.
    assert "email" not in body["user"]
    assert "phone" not in body["user"]
    assert body["access"] is None
    assert body["groups"] == []
    assert "recent_activity" not in body


@pytest.mark.database
def test_a_reader_with_users_view_sees_the_access_breakdown(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    mine = client.get(MINE, headers=headers).get_json()
    identifier = _someone_else(client, headers, mine_id=mine["user"]["id"])

    body = client.get(f"{MINE}/{identifier}", headers=headers).get_json()
    assert body["is_me"] is False
    assert body["visibility"]["contact"] is True
    assert body["visibility"]["access"] is True
    assert body["access"]["effective"]


@pytest.mark.database
def test_the_activity_trail_of_another_person_needs_audit_view(client, monkeypatch):
    """A per-person list of everything somebody did is the audit log.

    `users.view` gets a colleague's access; it does not get their trail. This
    is asserted with a persona holding one and not the other, because the
    distinction is the only thing standing between a directory and
    surveillance.
    """
    headers = _authenticate(monkeypatch)
    mine = client.get(MINE, headers=headers).get_json()
    identifier = _someone_else(client, headers, mine_id=mine["user"]["id"])

    monkeypatch.setattr(
        "src.core.auth._permissions_for", lambda *_: {"records.view", "users.view"}
    )
    body = client.get(f"{MINE}/{identifier}", headers=headers).get_json()
    assert body["visibility"]["activity"] is False
    assert "recent_activity" not in body

    monkeypatch.setattr(
        "src.core.auth._permissions_for",
        lambda *_: {"records.view", "users.view", "audit.view"},
    )
    allowed = client.get(f"{MINE}/{identifier}", headers=headers).get_json()
    assert allowed["visibility"]["activity"] is True
    assert isinstance(allowed["recent_activity"], list)


@pytest.mark.database
def test_a_person_who_does_not_exist_is_a_404(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    assert client.get(f"{MINE}/{uuid4()}", headers=headers).status_code == 404


# ── the numbers ──────────────────────────────────────────────────────────


@pytest.mark.database
def test_the_headline_counts_link_to_the_rows_behind_them(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    body = client.get(MINE, headers=headers).get_json()

    keyed = {stat["key"]: stat for stat in body["stats"]}
    assert set(keyed) == {
        "open_tasks", "done_tasks", "open_tickets", "resolved_tickets", "projects",
    }
    # A number nobody can open is a number nobody can check (§44).
    for stat in body["stats"]:
        assert stat["link"].startswith("/")
        assert body["user"]["id"] in stat["link"]
        assert isinstance(stat["value"], int)


@pytest.mark.database
def test_every_week_and_every_hour_has_a_bucket(client, monkeypatch):
    """A chart drawn only where there is data reports a quiet week as no week.

    The throughput bars and the heatmap cells are both dense, so the reader
    can tell "nothing happened on Sunday" from "Sunday is not shown".
    """
    headers = _authenticate(monkeypatch)
    body = client.get(MINE, headers=headers).get_json()

    assert len(body["throughput"]) == service.THROUGHPUT_WEEKS + 1
    assert all(point["value"] >= 0 for point in body["throughput"])
    # Monday-based and in order, which is what makes it line up with
    # `date_trunc('week')` and with every calendar in the product.
    buckets = [point["bucket"] for point in body["throughput"]]
    assert buckets == sorted(buckets)

    assert len(body["heatmap"]) == 7 * 24
    assert {cell["day"] for cell in body["heatmap"]} == set(range(7))
    assert {cell["hour"] for cell in body["heatmap"]} == set(range(24))


@pytest.mark.database
def test_what_they_work_on_is_ordered_and_capped(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    body = client.get(MINE, headers=headers).get_json()

    touches = body["touches"]
    assert len(touches) <= service.TOUCH_LIMIT
    # Most first: a chart of record types read in database order tells the
    # reader nothing about which they spend their time on.
    assert [entry["value"] for entry in touches] == sorted(
        (entry["value"] for entry in touches), reverse=True
    )


@pytest.mark.cache
@pytest.mark.database
def test_finishing_a_task_shows_up_on_the_page_immediately(client, monkeypatch):
    """The analytics are cached, and a write is what makes them stale.

    A profile behind a timer would tell the person who just finished a task
    that they have not — and they are the one reader guaranteed to look.
    """
    from src.core.db import session_scope
    from src.models.business import Task
    from src.models.platform import ActivityEntry, AuditLog

    headers = _authenticate(monkeypatch)
    mine = client.get(MINE, headers=headers).get_json()
    identifier = mine["user"]["id"]

    def done() -> int:
        body = client.get(MINE, headers=headers).get_json()
        return next(stat["value"] for stat in body["stats"] if stat["key"] == "done_tasks")

    before = done()
    # Cached now: without this the assertion below could pass on a page that
    # never cached anything.
    assert done() == before

    created = client.post(
        f"{PREFIX}/api/records/task",
        json={"title": "Profile analytics probe", "status": "NEW", "assignee_id": identifier},
        headers=headers,
    )
    assert created.status_code == 201, created.get_json()
    task_id = created.get_json()["id"]

    try:
        assert client.put(
            f"{PREFIX}/api/records/task/{task_id}", json={"status": "DONE"}, headers=headers
        ).status_code == 200
        assert done() == before + 1
    finally:
        with session_scope() as session:
            session.query(ActivityEntry).filter(
                ActivityEntry.resource_id == task_id
            ).delete(synchronize_session=False)
            session.query(AuditLog).filter(AuditLog.resource_id == task_id).delete(
                synchronize_session=False
            )
            session.query(Task).filter(Task.id == task_id).delete(synchronize_session=False)
