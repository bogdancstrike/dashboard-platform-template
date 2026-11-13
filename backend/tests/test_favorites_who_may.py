"""Bookmarks and recents — one store for "what have I starred" (§38, §39). — who may see it."""

from __future__ import annotations

import uuid

from sqlalchemy import select

from src.core.db import session_scope
from tests.favorites_support import (  # noqa: F401
    FAVORITES,
    RECENTS,
    _authenticate,
    _bookmark,
    pytestmark,
)


def test_no_permission_is_needed_for_your_own(client, monkeypatch):
    # A viewer holds almost nothing, and these are their own bookmarks.
    headers = _authenticate(monkeypatch, "user", "viewer")
    assert client.get(FAVORITES, headers=headers).status_code == 200
    assert client.get(RECENTS, headers=headers).status_code == 200
    listing = _bookmark(client, headers, label="Viewer bookmark")
    made = next(item for item in listing["items"] if item["label"] == "Viewer bookmark")
    client.delete(f"{FAVORITES}/{made['id']}", headers=headers)


def test_a_caller_with_no_token_is_refused(client):
    assert client.get(FAVORITES).status_code == 401
    assert client.get(RECENTS).status_code == 401


def test_a_bookmark_is_audited_but_leaves_no_activity(client, monkeypatch):
    from src.models.platform import ActivityEntry, AuditLog

    headers = _authenticate(monkeypatch)
    resource_id = str(uuid.uuid4())
    listing = _bookmark(client, headers, resource_id=resource_id, label="Audited")
    made = next(item for item in listing["items"] if item["resource_id"] == resource_id)

    try:
        with session_scope() as session:
            audited = session.scalars(
                select(AuditLog.action).where(AuditLog.resource_id == resource_id)
            ).all()
            noise = session.scalars(
                select(ActivityEntry.id).where(ActivityEntry.resource_id == resource_id)
            ).all()
        assert "favorite.add" in audited
        # One activity entry per bookmark would drown a feed in "starred a
        # ticket" (§48).
        assert noise == []
    finally:
        client.delete(f"{FAVORITES}/{made['id']}", headers=headers)
