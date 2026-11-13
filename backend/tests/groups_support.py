"""Shared helpers and fixtures for the groups tests."""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select

from src.config import Config
from src.core.db import session_scope
from tests.conftest import persona_claims

pytestmark = pytest.mark.database


PREFIX = Config.API_PREFIX


GROUPS = f"{PREFIX}/admin/groups"


def _authenticate(monkeypatch, username: str = "admin", role: str = "administrator"):
    monkeypatch.setattr(
        "src.core.auth.tokens.verify_token",
        lambda _token: persona_claims(username, role, sid=f"grp-{username}"),
    )
    return {"Authorization": f"Bearer grp-{username}"}


def _make(client, headers, name: str | None = None, **extra) -> dict:
    """A group of this test's own, so nothing here edits a seeded one."""
    body = {"name": name or f"Test group {uuid.uuid4().hex[:8]}", **extra}
    answer = client.post(GROUPS, headers=headers, json=body)
    assert answer.status_code == 201, answer.get_json()
    return answer.get_json()


def _persona_id(username: str) -> uuid.UUID:
    from src.models.identity import User

    with session_scope() as session:
        user = session.scalar(select(User).where(User.username == username))
        assert user is not None, f"the seed has no {username}"
        return user.id
