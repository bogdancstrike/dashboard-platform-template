"""Shared helpers and fixtures for the roles tests."""

from __future__ import annotations

import pytest

from src.config import Config
from tests.conftest import persona_claims

PREFIX = Config.API_PREFIX


def _claims(username: str, role: str) -> dict:
    return persona_claims(username, role, sid=f"roles-{username}")


def _authenticate(monkeypatch, username: str = "admin", role: str = "administrator"):
    monkeypatch.setattr("src.core.auth.tokens.verify_token", lambda _token: _claims(username, role))
    return {"Authorization": f"Bearer roles-{username}"}


@pytest.fixture()
def restore_roles(has_database):
    """Put every role's permissions back however the test ends.

    These tests edit live authorization against the demo database. Leaving a
    role changed would silently alter what every later test — and every later
    demo — is allowed to do.
    """
    if not has_database:
        yield
        return

    from sqlalchemy import select

    from src.core.db import session_scope
    from src.models.identity import Role

    with session_scope() as session:
        snapshot = {
            row.code: (row.name, row.description, list(row.permissions or []))
            for row in session.scalars(select(Role)).all()
        }
    yield
    with session_scope() as session:
        for row in session.scalars(select(Role)).all():
            saved = snapshot.get(row.code)
            if saved:
                row.name, row.description, row.permissions = saved
