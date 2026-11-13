"""Data Explorer HTTP contract: auth, SQL queries and saved visibility. — private search."""

from __future__ import annotations

from uuid import uuid4

import pytest
from sqlalchemy import select

from tests.explorer_support import (  # noqa: F401
    PREFIX,
    _authenticate,
    created_searches,
)


@pytest.mark.database
def test_private_search_is_not_discoverable_by_another_user(client, monkeypatch, created_searches):
    owner_headers = _authenticate(monkeypatch)
    created = client.post(
        f"{PREFIX}/api/saved-searches", headers=owner_headers,
        json={
            "name": f"Private explorer {uuid4()}", "resource_type": "task",
            "columns": ["reference", "title"], "sort": "updated_at", "order": "desc",
            "page_size": 25, "view_mode": "table",
        },
    ).get_json()
    created_searches.append(created["id"])

    other_headers = _authenticate(monkeypatch, "user", "viewer")
    listed = client.get(
        f"{PREFIX}/api/saved-searches?resource_type=task", headers=other_headers,
    ).get_json()["items"]
    direct = client.get(f"{PREFIX}/api/saved-searches/{created['id']}", headers=other_headers)

    assert created["id"] not in {item["id"] for item in listed}
    assert direct.status_code == 404


@pytest.mark.database
def test_sharing_needs_the_share_permission(client, monkeypatch, created_searches):
    """A viewer keeps their own searches and publishes none of anyone's."""
    from src.core.db import session_scope
    from src.models.identity import User

    with session_scope() as session:
        colleague = session.scalars(
            select(User).where(User.email == "manager@nucleus.example")
        ).one()

    viewer_headers = _authenticate(monkeypatch, "user", "viewer")
    private = {
        "name": f"Viewer private {uuid4()}", "resource_type": "task",
        "columns": ["reference", "title"], "sort": "updated_at", "order": "desc",
        "page_size": 25, "view_mode": "table",
    }
    own = client.post(f"{PREFIX}/api/saved-searches", headers=viewer_headers, json=private)
    published = client.post(
        f"{PREFIX}/api/saved-searches", headers=viewer_headers,
        json={**private, "name": f"Viewer public {uuid4()}", "scope": "PUBLIC"},
    )
    shared = client.post(
        f"{PREFIX}/api/saved-searches", headers=viewer_headers,
        json={**private, "name": f"Viewer shared {uuid4()}", "member_ids": [str(colleague.id)]},
    )

    created_searches.append(own.get_json()["id"])
    assert own.status_code == 201
    assert published.status_code == 403
    assert shared.status_code == 403
    assert "searches.share" in str(published.get_json()["details"])


@pytest.mark.database
def test_ownership_transfer_is_explicit_and_leaves_the_previous_owner_reading(client, monkeypatch, created_searches):
    from src.core.db import session_scope
    from src.models.identity import User

    with session_scope() as session:
        recipient = session.scalars(
            select(User).where(User.email == "manager@nucleus.example")
        ).one()
        recipient_id, recipient_name = str(recipient.id), recipient.full_name

    owner_headers = _authenticate(monkeypatch)
    created = client.post(
        f"{PREFIX}/api/saved-searches", headers=owner_headers,
        json={
            "name": f"Handover {uuid4()}", "resource_type": "task", "scope": "SHARED",
            "columns": ["reference", "title"], "sort": "updated_at", "order": "desc",
            "page_size": 25, "view_mode": "table",
        },
    ).get_json()
    created_searches.append(created["id"])

    handed = client.post(
        f"{PREFIX}/api/saved-searches/{created['id']}/transfer", headers=owner_headers,
        json={"owner_id": recipient_id},
    )

    assert handed.status_code == 200
    body = handed.get_json()
    assert body["owner"]["id"] == recipient_id
    assert body["owner"]["name"] == recipient_name
    # The previous owner is now a member: still reading, no longer deciding.
    assert created["owner"]["id"] in {member["id"] for member in body["members"]}

    after = client.get(f"{PREFIX}/api/saved-searches/{created['id']}", headers=owner_headers)
    assert after.status_code == 200
    assert after.get_json()["can_edit"] is False
    assert client.put(
        f"{PREFIX}/api/saved-searches/{created['id']}", headers=owner_headers,
        json={"name": "Mine again"},
    ).status_code == 403

    # The handover itself is on the audit trail (§21).
    with session_scope() as session:
        from src.models.platform import AuditLog

        actions = session.scalars(
            select(AuditLog.action).where(AuditLog.resource_id == created["id"])
        ).all()
    assert "TRANSFER" in actions


@pytest.mark.database
def test_transfer_refuses_a_recipient_who_cannot_receive(client, monkeypatch, created_searches):
    headers = _authenticate(monkeypatch)
    created = client.post(
        f"{PREFIX}/api/saved-searches", headers=headers,
        json={
            "name": f"Nowhere {uuid4()}", "resource_type": "task",
            "columns": ["reference", "title"], "sort": "updated_at", "order": "desc",
            "page_size": 25, "view_mode": "table",
        },
    ).get_json()
    created_searches.append(created["id"])

    nobody = client.post(
        f"{PREFIX}/api/saved-searches/{created['id']}/transfer", headers=headers,
        json={"owner_id": str(uuid4())},
    )
    itself = client.post(
        f"{PREFIX}/api/saved-searches/{created['id']}/transfer", headers=headers,
        json={"owner_id": created["owner"]["id"]},
    )

    assert nobody.status_code == 400
    assert itself.status_code == 400
    assert "already belongs" in itself.get_json()["message"]


@pytest.mark.database
def test_the_people_directory_answers_a_share_picker(client, monkeypatch):
    headers = _authenticate(monkeypatch, "user", "viewer")

    everyone = client.get(f"{PREFIX}/api/directory/people", headers=headers)
    searched = client.get(f"{PREFIX}/api/directory/people?q=manager", headers=headers)

    assert everyone.status_code == 200
    body = everyone.get_json()
    assert body["total"] > 0
    assert len(body["items"]) <= 50
    person = body["items"][0]
    assert set(person) == {
        "id", "name", "email", "username", "job_title", "avatar_url", "initials", "is_me",
    }
    assert searched.status_code == 200
    assert all(
        "manager" in (item["name"] + item["email"] + item["username"] + (item["job_title"] or "")).lower()
        for item in searched.get_json()["items"]
    )


def test_the_people_directory_requires_a_token(client):
    assert client.get(f"{PREFIX}/api/directory/people").status_code == 401


@pytest.mark.database
def test_the_result_echoes_what_was_searched_for_so_matches_can_be_marked(client, monkeypatch):
    """§6 highlighting marks the executed term, not the one being typed."""
    response = client.post(
        f"{PREFIX}/api/explorer/query", headers=_authenticate(monkeypatch),
        json={"resource_type": "task", "query_text": "  audit  ", "page_size": 5},
    )

    body = response.get_json()
    assert body["query_text"] == "audit"
    # `tags` joined them when the vocabulary shipped (§37): typing a tag name
    # into a list's search box finding the records carrying it is what anybody
    # would expect, and the array column is cast to text for the same `ilike`
    # every other searchable field uses.
    assert set(body["searchable"]) == {"reference", "title", "description", "tags"}
    assert body["total"] > 0


@pytest.mark.database
def test_a_facet_filter_sent_as_a_list_narrows_the_same_way_as_a_string(client, monkeypatch):
    """The explorer posts JSON, where `?priority=CRITICAL` is `["CRITICAL"]`.

    Stringifying that list produced `"['CRITICAL']"` and a filter that matched
    nothing — an empty table rather than an error, which is the hardest kind of
    wrong answer to notice.
    """
    headers = _authenticate(monkeypatch)
    body = {"resource_type": "task", "columns": ["reference", "priority"], "page_size": 10}

    as_list = client.post(
        f"{PREFIX}/api/explorer/query", headers=headers,
        json={**body, "filters": {"priority": ["CRITICAL"]}},
    ).get_json()
    as_text = client.post(
        f"{PREFIX}/api/explorer/query", headers=headers,
        json={**body, "filters": {"priority": "CRITICAL"}},
    ).get_json()
    unfiltered = client.post(f"{PREFIX}/api/explorer/query", headers=headers, json=body).get_json()
    cleared = client.post(
        f"{PREFIX}/api/explorer/query", headers=headers,
        json={**body, "filters": {"priority": []}},
    ).get_json()

    assert as_list["total"] == as_text["total"] > 0
    assert as_list["total"] < unfiltered["total"]
    assert all(item["priority"] == "CRITICAL" for item in as_list["items"])
    # An emptied multi-select means "stop narrowing", not "match nothing".
    assert cleared["total"] == unfiltered["total"]
