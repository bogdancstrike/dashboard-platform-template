"""Notification centre HTTP contract (§17).

The property worth testing hardest is not the list — it is the scoping. A
notification belongs to exactly one person, and every one of these endpoints
takes an id in the path. An endpoint that looks a row up by id alone will
eventually hand somebody else's mail to whoever guesses a UUID, and that is a
bug no amount of reading the code reliably catches.
"""

from __future__ import annotations

from uuid import UUID, uuid4

import pytest

from src.config import Config

PREFIX = Config.API_PREFIX


def _claims(username: str, role: str) -> dict:
    return {
        "sub": "", "email": f"{username}@nucleus.example",
        "preferred_username": username, "name": username.title(),
        "sid": f"notify-{username}", "realm_access": {"roles": [role]},
    }


def _authenticate(monkeypatch, username: str = "admin", role: str = "administrator"):
    monkeypatch.setattr("src.core.auth.verify_token", lambda _token: _claims(username, role))
    return {"Authorization": f"Bearer notify-{username}"}


@pytest.fixture()
def planted(has_database):
    """Notifications a test creates, removed however the test ends.

    The suite runs against the same PostgreSQL the application serves, so rows
    left behind become part of what the next person sees when they open the
    bell — and "notify-test 8f3c…" in a demo notification centre is not a demo
    anybody wants to show.
    """
    identifiers: list[UUID] = []
    yield identifiers

    if not has_database or not identifiers:
        return
    from sqlalchemy import delete as sql_delete

    from src.core.db import session_scope
    from src.models.platform import Notification

    with session_scope() as session:
        session.execute(sql_delete(Notification).where(Notification.id.in_(identifiers)))


def _user_id(username: str) -> UUID:
    from sqlalchemy import select

    from src.core.db import session_scope
    from src.models.identity import User

    with session_scope() as session:
        return session.scalars(select(User.id).where(User.username == username)).one()


def _plant(planted: list[UUID], *, username: str, count: int, **overrides) -> list[UUID]:
    """Write `count` notifications for `username` and register them for cleanup."""
    from src.core.db import session_scope
    from src.models.platform import Notification

    user_id = _user_id(username)
    created: list[UUID] = []
    with session_scope() as session:
        for index in range(count):
            row = Notification(
                id=uuid4(),
                user_id=user_id,
                category=overrides.get("category", "ASSIGNMENT"),
                severity=overrides.get("severity", "INFO"),
                title=overrides.get("title", f"notify-test {index}"),
                body="planted by the test suite",
                is_read=overrides.get("is_read", False),
                group_key=overrides.get("group_key", f"notify-test:{uuid4()}"),
            )
            session.add(row)
            created.append(row.id)
    planted.extend(created)
    return created


def test_every_notification_endpoint_requires_a_bearer_token(client):
    identifier = uuid4()
    assert client.get(f"{PREFIX}/notifications").status_code == 401
    assert client.get(f"{PREFIX}/notifications/counts").status_code == 401
    assert client.put(f"{PREFIX}/notifications/{identifier}", json={}).status_code == 401
    assert client.delete(f"{PREFIX}/notifications/{identifier}").status_code == 401
    assert client.post(f"{PREFIX}/notifications/read-all", json={}).status_code == 401


@pytest.mark.database
def test_listing_returns_the_callers_own_rows_with_unread_counts(client, monkeypatch, planted):
    _plant(planted, username="admin", count=2, category="APPROVAL")
    headers = _authenticate(monkeypatch)

    body = client.get(f"{PREFIX}/notifications?page_size=100", headers=headers).get_json()

    assert body["total"] >= 2
    assert body["grouped"] is False
    assert body["unread"] >= 2
    assert body["by_category"]["APPROVAL"] >= 2
    titles = {item["title"] for item in body["items"]}
    assert {"notify-test 0", "notify-test 1"}.issubset(titles)
    # Serialised for the reader, not for the ORM: the page renders these
    # directly and a raw UUID or datetime object would reach it as a string of
    # Python repr.
    assert all(isinstance(item["id"], str) for item in body["items"])


@pytest.mark.database
def test_filters_narrow_by_category_severity_and_read_state(client, monkeypatch, planted):
    _plant(planted, username="admin", count=3, category="SECURITY", severity="CRITICAL")
    _plant(planted, username="admin", count=1, category="SECURITY", severity="INFO", is_read=True)
    headers = _authenticate(monkeypatch)

    critical = client.get(
        f"{PREFIX}/notifications?category=SECURITY&severity=CRITICAL&read=unread&page_size=100",
        headers=headers,
    ).get_json()
    read_only = client.get(
        f"{PREFIX}/notifications?category=SECURITY&severity=INFO&read=read&page_size=100",
        headers=headers,
    ).get_json()

    assert critical["total"] >= 3
    assert {item["severity"] for item in critical["items"]} == {"CRITICAL"}
    assert all(item["is_read"] is False for item in critical["items"])
    assert all(item["is_read"] is True for item in read_only["items"])


@pytest.mark.database
def test_grouping_collapses_a_group_key_into_one_row_that_counts_the_rest(
    client, monkeypatch, planted
):
    key = f"notify-test:group-{uuid4()}"
    _plant(planted, username="admin", count=5, group_key=key)
    headers = _authenticate(monkeypatch)

    grouped = client.get(
        f"{PREFIX}/notifications?group=true&group_key={key}", headers=headers
    ).get_json()
    flat = client.get(f"{PREFIX}/notifications?group_key={key}", headers=headers).get_json()

    assert flat["total"] == 5
    # Five rows, one line — the whole point of the grouped view.
    assert grouped["total"] == 1
    assert grouped["grouped"] is True
    assert len(grouped["items"]) == 1
    assert grouped["items"][0]["group_count"] == 5
    assert grouped["items"][0]["group_unread"] == 5


@pytest.mark.database
def test_a_row_without_a_group_key_stays_visible_in_the_grouped_view(
    client, monkeypatch, planted
):
    # Falling back to the id means a one-of-a-kind notice is its own group,
    # rather than disappearing into a single "ungrouped" pile.
    created = _plant(planted, username="admin", count=2, group_key=None)
    headers = _authenticate(monkeypatch)

    grouped = client.get(
        f"{PREFIX}/notifications?group=true&page_size=100", headers=headers
    ).get_json()

    listed = {item["id"] for item in grouped["items"]}
    assert {str(identifier) for identifier in created}.issubset(listed)


@pytest.mark.database
def test_marking_one_read_and_unread_round_trips(client, monkeypatch, planted):
    identifier = _plant(planted, username="admin", count=1)[0]
    headers = _authenticate(monkeypatch)

    read = client.put(f"{PREFIX}/notifications/{identifier}", headers=headers, json={})
    unread = client.put(
        f"{PREFIX}/notifications/{identifier}", headers=headers, json={"is_read": False}
    )

    assert read.status_code == 200
    assert read.get_json()["is_read"] is True
    assert read.get_json()["read_at"] is not None
    assert unread.get_json()["is_read"] is False
    assert unread.get_json()["read_at"] is None


@pytest.mark.database
def test_mark_all_read_can_be_scoped_to_one_collapsed_group(client, monkeypatch, planted):
    key = f"notify-test:dismiss-{uuid4()}"
    _plant(planted, username="admin", count=4, group_key=key)
    _plant(planted, username="admin", count=2, category="REPORT")
    headers = _authenticate(monkeypatch)

    marked = client.post(
        f"{PREFIX}/notifications/read-all", headers=headers, json={"group_key": key}
    )

    assert marked.status_code == 200
    assert marked.get_json()["marked"] == 4
    remaining = client.get(
        f"{PREFIX}/notifications?group_key={key}&read=unread", headers=headers
    ).get_json()
    assert remaining["total"] == 0
    # The rows outside the group are untouched — a scoped dismiss that quietly
    # clears the whole centre is worse than one that does nothing.
    others = client.get(
        f"{PREFIX}/notifications?category=REPORT&read=unread&page_size=100", headers=headers
    ).get_json()
    assert others["total"] >= 2


@pytest.mark.database
def test_a_notification_belonging_to_someone_else_is_invisible_and_unreachable(
    client, monkeypatch, planted
):
    # §17's acceptance criterion, asserted rather than inspected: the id is
    # never enough on its own.
    identifier = _plant(planted, username="manager", count=1, title="notify-test private")[0]
    headers = _authenticate(monkeypatch, "user", "viewer")

    listed = client.get(f"{PREFIX}/notifications?page_size=200", headers=headers).get_json()
    fetched = client.put(f"{PREFIX}/notifications/{identifier}", headers=headers, json={})
    removed = client.delete(f"{PREFIX}/notifications/{identifier}", headers=headers)

    assert str(identifier) not in {item["id"] for item in listed["items"]}
    assert fetched.status_code == 404
    assert removed.status_code == 404


@pytest.mark.database
def test_a_missing_notification_is_a_404_and_a_malformed_id_is_a_400(client, monkeypatch):
    headers = _authenticate(monkeypatch)

    missing = client.put(f"{PREFIX}/notifications/{uuid4()}", headers=headers, json={})
    # The typed route converter refuses to match a non-UUID at all, so the
    # string never reaches a handler and never reaches SQL. Which 4xx the
    # router settles on is its business; what matters is that
    # `invalid input syntax for type uuid` is not a 500 in the logs.
    malformed = client.put(f"{PREFIX}/notifications/not-a-uuid", headers=headers, json={})

    assert missing.status_code == 404
    assert 400 <= malformed.status_code < 500


@pytest.mark.database
def test_invalid_paging_and_read_state_are_client_errors(client, monkeypatch):
    headers = _authenticate(monkeypatch)

    assert client.get(f"{PREFIX}/notifications?page_size=9999", headers=headers).status_code == 400
    assert client.get(f"{PREFIX}/notifications?read=maybe", headers=headers).status_code == 400


@pytest.mark.database
def test_deleting_removes_the_row_from_the_callers_centre(client, monkeypatch, planted):
    identifier = _plant(planted, username="admin", count=1)[0]
    headers = _authenticate(monkeypatch)

    removed = client.delete(f"{PREFIX}/notifications/{identifier}", headers=headers)
    listed = client.get(f"{PREFIX}/notifications?page_size=200", headers=headers).get_json()

    assert removed.status_code == 200
    assert str(identifier) not in {item["id"] for item in listed["items"]}


@pytest.mark.database
def test_counts_answer_the_badge_without_the_list(client, monkeypatch, planted):
    _plant(planted, username="admin", count=3, category="MENTION")
    headers = _authenticate(monkeypatch)

    body = client.get(f"{PREFIX}/notifications/counts", headers=headers).get_json()

    assert body["unread"] >= 3
    assert body["by_category"]["MENTION"] >= 3
