"""Shared helpers and fixtures for the explorer tests."""

from __future__ import annotations

from uuid import UUID

import pytest
from sqlalchemy import select

from src.config import Config
from tests.conftest import persona_claims

PREFIX = Config.API_PREFIX


def _claims(username: str, role: str) -> dict:
    return persona_claims(username, role, sid=f"explorer-{username}")


def _authenticate(monkeypatch, username: str = "admin", role: str = "administrator"):
    monkeypatch.setattr("src.core.auth.tokens.verify_token", lambda _token: _claims(username, role))
    return {"Authorization": f"Bearer explorer-{username}"}


@pytest.fixture()
def created_searches(has_database):
    """Saved searches a test creates, removed however the test ends.

    This suite runs against the same PostgreSQL the application serves, so a
    test that leaves rows behind changes what the next person to open the demo
    sees — and "Explorer test 8f3c… (copy)" in a saved-search panel is not a
    demo anybody wants to show. Removed through the session rather than the API
    because ownership may have moved during the test.
    """
    identifiers: list[str] = []
    yield identifiers

    if not has_database or not identifiers:
        return
    from sqlalchemy import delete as sql_delete

    from src.core.db import session_scope
    from src.models.personal import ResourceShare, SavedSearch

    with session_scope() as session:
        session.execute(sql_delete(ResourceShare).where(
            ResourceShare.resource_type == "saved_search",
            ResourceShare.resource_id.in_(identifiers),
        ))
        session.execute(sql_delete(SavedSearch).where(
            SavedSearch.id.in_([UUID(value) for value in identifiers])
        ))


@pytest.fixture()
def preserved_defaults(has_database):
    """Whatever the demo database says is default, said again afterwards.

    A test that marks a search as its owner's default *demotes* the one that
    held the flag — that is the rule being tested (§46). Deleting the rows the
    test made does not put the demoted one back, so the flags are snapshotted
    and restored. The suite runs against the database the application serves;
    silently changing which search a persona's list opens with is exactly the
    kind of damage a demo shows to the next person who opens it.
    """
    if not has_database:
        yield
        return

    from src.core.db import session_scope
    from src.models.personal import SavedSearch

    with session_scope() as session:
        before = {
            row.id: row.is_default
            for row in session.scalars(select(SavedSearch)).unique().all()
        }
    yield
    with session_scope() as session:
        for row in session.scalars(
            select(SavedSearch).where(SavedSearch.id.in_(before))
        ).unique().all():
            if row.is_default != before[row.id]:
                row.is_default = before[row.id]
