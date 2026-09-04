"""Data Explorer HTTP contract: auth, SQL queries and saved visibility."""

from __future__ import annotations

from uuid import uuid4

import pytest
from sqlalchemy import select

from src.config import Config

PREFIX = Config.API_PREFIX


def _claims(username: str, role: str) -> dict:
    return {
        "sub": "", "email": f"{username}@nucleus.example",
        "preferred_username": username, "name": username.title(),
        "sid": f"explorer-{username}", "realm_access": {"roles": [role]},
    }


def _authenticate(monkeypatch, username: str = "admin", role: str = "administrator"):
    monkeypatch.setattr("src.core.auth.verify_token", lambda _token: _claims(username, role))
    return {"Authorization": f"Bearer explorer-{username}"}


def test_explorer_endpoints_require_a_bearer_token(client):
    assert client.get(f"{PREFIX}/api/explorer/catalog").status_code == 401
    assert client.post(f"{PREFIX}/api/explorer/query", json={}).status_code == 401
    assert client.get(f"{PREFIX}/api/saved-searches").status_code == 401


@pytest.mark.database
def test_catalogue_is_live_and_drives_the_query_contract(client, monkeypatch):
    response = client.get(f"{PREFIX}/api/explorer/catalog", headers=_authenticate(monkeypatch))

    assert response.status_code == 200
    tasks = next(item for item in response.get_json()["items"] if item["key"] == "task")
    assert tasks["record_count"] > 0
    status = next(field for field in tasks["fields"] if field["name"] == "status")
    assert {"eq", "not_in", "empty"}.issubset(status["operators"])
    assert status["choices"]


@pytest.mark.database
def test_query_combines_simple_and_nested_conditions_in_sql(client, monkeypatch):
    from src.core.db import session_scope
    from src.models.business import Task

    with session_scope() as session:
        sample = session.scalars(select(Task).where(Task.deleted_at.is_(None)).limit(1)).one()

    response = client.post(
        f"{PREFIX}/api/explorer/query", headers=_authenticate(monkeypatch),
        json={
            "resource_type": "task", "query_text": sample.reference,
            "condition_tree": {
                "type": "group", "conjunction": "AND", "children1": {
                    "status": {"type": "rule", "properties": {
                        "field": "status", "operator": "select_equals", "value": [sample.status],
                    }},
                },
            },
            "columns": ["reference", "title", "status"], "page": 1, "page_size": 10,
        },
    )

    assert response.status_code == 200
    body = response.get_json()
    assert body["total"] == 1
    assert body["items"][0]["reference"] == sample.reference
    assert "Status =" in body["condition_text"]
    assert body["rule_count"] == 1


@pytest.mark.database
def test_query_rejects_unknown_resources_and_operators(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    unknown = client.post(
        f"{PREFIX}/api/explorer/query", headers=headers,
        json={"resource_type": "secrets"},
    )
    invalid = client.post(
        f"{PREFIX}/api/explorer/query", headers=headers,
        json={"resource_type": "task", "condition_tree": {
            "type": "rule", "properties": {
                "field": "progress", "operator": "contains", "value": ["5"],
            },
        }},
    )

    assert unknown.status_code == 400
    assert "task" in unknown.get_json()["details"]["available"]
    assert invalid.status_code == 400
    assert "cannot be applied" in invalid.get_json()["message"]


@pytest.mark.database
def test_explorer_checks_live_rbac_after_jwt_verification(client, monkeypatch):
    _authenticate(monkeypatch, "user", "viewer")
    monkeypatch.setattr("src.core.auth._permissions_for", lambda *_args: set())

    response = client.get(
        f"{PREFIX}/api/explorer/catalog",
        headers={"Authorization": "Bearer verified-but-unprivileged"},
    )

    assert response.status_code == 403
    assert response.get_json()["details"]["missing"] == ["records.view"]


@pytest.mark.database
def test_saved_search_lifecycle_preserves_question_and_presentation(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    name = f"Explorer test {uuid4()}"
    payload = {
        "name": name, "resource_type": "task", "scope": "PRIVATE",
        "query_text": "review", "condition_tree": {
            "type": "group", "conjunction": "AND", "children1": {
                "priority": {"type": "rule", "properties": {
                    "field": "priority", "operator": "select_any_in", "value": [["HIGH", "CRITICAL"]],
                }},
            },
        },
        "sort": "due_date", "order": "asc",
        "columns": ["reference", "title", "priority", "due_date"],
        "page_size": 50, "view_mode": "table",
    }
    created = client.post(f"{PREFIX}/api/saved-searches", headers=headers, json=payload)
    assert created.status_code == 201
    search = created.get_json()
    assert search["condition_text"].strip() == "Priority in ['HIGH', 'CRITICAL']"
    assert search["can_edit"] is True

    listed = client.get(
        f"{PREFIX}/api/saved-searches?resource_type=task", headers=headers,
    ).get_json()["items"]
    assert search["id"] in {item["id"] for item in listed}

    updated = client.put(
        f"{PREFIX}/api/saved-searches/{search['id']}", headers=headers,
        json={"name": f"{name} renamed", "is_favorite": True},
    )
    assert updated.status_code == 200
    assert updated.get_json()["is_favorite"] is True

    copied = client.post(
        f"{PREFIX}/api/saved-searches/{search['id']}/duplicate", headers=headers,
    )
    assert copied.status_code == 201
    assert copied.get_json()["scope"] == "PRIVATE"
    assert copied.get_json()["owner"]["id"] == search["owner"]["id"]

    assert client.delete(f"{PREFIX}/api/saved-searches/{search['id']}", headers=headers).status_code == 204
    assert client.get(f"{PREFIX}/api/saved-searches/{search['id']}", headers=headers).status_code == 404


@pytest.mark.database
def test_shared_search_is_readable_but_only_owner_can_mutate(client, monkeypatch):
    from src.core.db import session_scope
    from src.models.identity import User

    with session_scope() as session:
        member = session.scalars(select(User).where(User.email == "user@nucleus.example")).one()

    owner_headers = _authenticate(monkeypatch)
    created = client.post(
        f"{PREFIX}/api/saved-searches", headers=owner_headers,
        json={
            "name": f"Shared explorer {uuid4()}", "resource_type": "task", "scope": "SHARED",
            "member_ids": [str(member.id)], "columns": ["reference", "title"],
            "sort": "updated_at", "order": "desc", "page_size": 25, "view_mode": "list",
        },
    ).get_json()

    member_headers = _authenticate(monkeypatch, "user", "viewer")
    opened = client.get(f"{PREFIX}/api/saved-searches/{created['id']}", headers=member_headers)
    denied = client.put(
        f"{PREFIX}/api/saved-searches/{created['id']}", headers=member_headers,
        json={"name": "Taken over"},
    )

    assert opened.status_code == 200
    assert opened.get_json()["can_edit"] is False
    assert denied.status_code == 403
    assert "Only the owner" in denied.get_json()["message"]


@pytest.mark.database
def test_private_search_is_not_discoverable_by_another_user(client, monkeypatch):
    owner_headers = _authenticate(monkeypatch)
    created = client.post(
        f"{PREFIX}/api/saved-searches", headers=owner_headers,
        json={
            "name": f"Private explorer {uuid4()}", "resource_type": "task",
            "columns": ["reference", "title"], "sort": "updated_at", "order": "desc",
            "page_size": 25, "view_mode": "table",
        },
    ).get_json()

    other_headers = _authenticate(monkeypatch, "user", "viewer")
    listed = client.get(
        f"{PREFIX}/api/saved-searches?resource_type=task", headers=other_headers,
    ).get_json()["items"]
    direct = client.get(f"{PREFIX}/api/saved-searches/{created['id']}", headers=other_headers)

    assert created["id"] not in {item["id"] for item in listed}
    assert direct.status_code == 404


@pytest.mark.database
def test_sharing_needs_the_share_permission(client, monkeypatch):
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

    assert own.status_code == 201
    assert published.status_code == 403
    assert shared.status_code == 403
    assert "searches.share" in str(published.get_json()["details"])


@pytest.mark.database
def test_ownership_transfer_is_explicit_and_leaves_the_previous_owner_reading(client, monkeypatch):
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
def test_transfer_refuses_a_recipient_who_cannot_receive(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    created = client.post(
        f"{PREFIX}/api/saved-searches", headers=headers,
        json={
            "name": f"Nowhere {uuid4()}", "resource_type": "task",
            "columns": ["reference", "title"], "sort": "updated_at", "order": "desc",
            "page_size": 25, "view_mode": "table",
        },
    ).get_json()

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
