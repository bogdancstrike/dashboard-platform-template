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
