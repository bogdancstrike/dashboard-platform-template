"""Shared helpers and fixtures for the docs tests."""

from __future__ import annotations

from uuid import UUID, uuid4

import pytest
from sqlalchemy import select

from src.config import Config
from tests.conftest import persona_claims

PREFIX = Config.API_PREFIX


DOCS = f"{PREFIX}/api/docs"


ROLES = {"admin": "administrator", "manager": "manager", "user": "user", "analyst": "analyst"}


@pytest.fixture()
def people(monkeypatch):
    def verify(token: str):
        username = token.removeprefix("docs-")
        return persona_claims(username, ROLES[username], sid=f"docs-{username}")

    monkeypatch.setattr("src.core.auth.tokens.verify_token", verify)
    return {name: {"Authorization": f"Bearer docs-{name}"} for name in ROLES}


@pytest.fixture()
def space(client, people):
    created = client.post(f"{DOCS}/spaces", json={"name": f"Test space {uuid4().hex[:6]}"},
                          headers=people["admin"])
    assert created.status_code == 201, created.get_json()
    return created.get_json()


def _page(client, headers, space_id, **extra):
    response = client.post(f"{DOCS}/pages", json={"space_id": space_id, **extra}, headers=headers)
    assert response.status_code == 201, response.get_json()
    return response.get_json()


def _user_id(username: str) -> UUID:
    from src.core.db import session_scope
    from src.models.identity import User

    with session_scope() as session:
        return session.scalars(select(User.id).where(User.username == username)).one()
