"""The signed-in user's platform profile and preferences (§40, §58)."""

from __future__ import annotations

import pytest
from sqlalchemy import select

from src.config import Config

PREFIX = Config.API_PREFIX


def _claims(username: str, role: str) -> dict:
    names = {
        "admin": "Ada Administrator",
        "manager": "Mara Manager",
        "operator": "Otto Operator",
        "analyst": "Ana Analyst",
        "user": "Uma User",
    }
    return {
        # Empty on purpose: these tests exercise email adoption without
        # replacing the real Keycloak subject a local stack may have stored.
        "sub": "",
        "email": f"{username}@nucleus.example",
        "preferred_username": username,
        "name": names.get(username, username.replace(".", " ").title()),
        "sid": f"test-session-{username}",
        "realm_access": {"roles": [role]},
    }


def _authenticate(monkeypatch, username: str = "admin", role: str = "administrator"):
    monkeypatch.setattr("src.core.auth.verify_token", lambda _token: _claims(username, role))
    return {"Authorization": "Bearer test-token"}


def test_me_requires_an_access_token(client):
    response = client.get(f"{PREFIX}/api/me")

    assert response.status_code == 401
    assert response.get_json()["error"] == "unauthorized"


@pytest.mark.database
def test_me_returns_the_live_platform_profile(client, monkeypatch):
    response = client.get(f"{PREFIX}/api/me", headers=_authenticate(monkeypatch))

    assert response.status_code == 200
    body = response.get_json()
    assert body["user"]["email"] == "admin@nucleus.example"
    assert body["user"]["avatar_url"].startswith("data:image/svg+xml")
    assert body["role"]["code"] == "ADMINISTRATOR"
    assert body["organization"]["name"]
    assert body["department"]["name"]
    assert body["team"]["name"]
    assert "admin.access" in body["permissions"]
    assert body["preferences"]["appearance"]["theme"] in {"light", "dark", "system"}
    assert [persona["username"] for persona in body["personas"]] == [
        "admin",
        "manager",
        "operator",
        "analyst",
        "user",
    ]


@pytest.mark.database
def test_me_rejects_an_inactive_local_profile(client, monkeypatch):
    from src.core.db import session_scope
    from src.models.identity import User

    with session_scope() as session:
        inactive = session.scalars(
            select(User).where(User.status != "ACTIVE", User.deleted_at.is_(None)).limit(1)
        ).one()
        username, email = inactive.username, inactive.email

    claims = _claims(username, "viewer")
    claims["email"] = email
    monkeypatch.setattr("src.core.auth.verify_token", lambda _token: claims)

    response = client.get(
        f"{PREFIX}/api/me", headers={"Authorization": "Bearer test-token"}
    )

    assert response.status_code == 403
    assert response.get_json()["details"]["status"] != "ACTIVE"


@pytest.mark.database
def test_me_updates_only_valid_preferences(client, monkeypatch):
    from src.core.db import session_scope
    from src.models.identity import User

    headers = _authenticate(monkeypatch, "user", "viewer")

    with session_scope() as session:
        user = session.scalars(select(User).where(User.email == "user@nucleus.example")).one()
        original = dict(user.preferences or {})

    try:
        invalid = client.put(
            f"{PREFIX}/api/me",
            headers=headers,
            json={"preferences": {"appearance": {"theme": "ultraviolet"}}},
        )
        assert invalid.status_code == 400
        assert invalid.get_json()["details"]["field"] == "preferences.appearance.theme"

        updated = client.put(
            f"{PREFIX}/api/me",
            headers=headers,
            json={
                "preferences": {
                    "appearance": {"theme": "dark", "density": "compact"},
                    "defaults": {"page_size": 50, "landing_page": "tasks"},
                }
            },
        )

        assert updated.status_code == 200
        preferences = updated.get_json()["preferences"]
        assert preferences["appearance"]["theme"] == "dark"
        assert preferences["appearance"]["density"] == "compact"
        assert isinstance(preferences["appearance"]["sidebar_collapsed"], bool)
        assert preferences["defaults"]["page_size"] == 50
    finally:
        with session_scope() as session:
            user = session.scalars(select(User).where(User.email == "user@nucleus.example")).one()
            user.preferences = original


@pytest.mark.database
def test_me_reads_role_permissions_fresh_on_every_request(client, monkeypatch):
    from src.core.db import session_scope
    from src.models.identity import Role

    headers = _authenticate(monkeypatch, "user", "viewer")
    with session_scope() as session:
        role = session.scalars(select(Role).where(Role.code == "VIEWER")).one()
        original = list(role.permissions or [])

    try:
        with session_scope() as session:
            role = session.scalars(select(Role).where(Role.code == "VIEWER")).one()
            role.permissions = [*original, "test.permission.live"]

        response = client.get(f"{PREFIX}/api/me", headers=headers)

        assert response.status_code == 200
        assert "test.permission.live" in response.get_json()["permissions"]
    finally:
        with session_scope() as session:
            role = session.scalars(select(Role).where(Role.code == "VIEWER")).one()
            role.permissions = original
