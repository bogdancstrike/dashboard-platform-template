"""Shared helpers and fixtures for the tags tests."""

from __future__ import annotations

from uuid import uuid4

import pytest
from sqlalchemy import select

from src.config import Config
from src.services.records import tags as service
from tests.conftest import persona_claims

PREFIX = Config.API_PREFIX


TAGS = f"{PREFIX}/tags"


def _authenticate(monkeypatch, username: str = "admin", role: str = "administrator"):
    monkeypatch.setattr(
        "src.core.auth.tokens.verify_token",
        lambda _token: persona_claims(username, role, sid=f"tags-{username}"),
    )
    return {"Authorization": f"Bearer tags-{username}"}


def _erase_tag(name: str) -> None:
    from src.core.db import session_scope
    from src.models.content import Tag, TagLink
    from src.models.platform import ActivityEntry, AuditLog

    with session_scope() as session:
        tag = session.scalars(select(Tag).where(Tag.slug == service.slugify(name))).first()
        if tag is None:
            return
        session.query(TagLink).filter(TagLink.tag_id == tag.id).delete(
            synchronize_session=False
        )
        session.query(ActivityEntry).filter(
            ActivityEntry.resource_id == str(tag.id)
        ).delete(synchronize_session=False)
        session.query(AuditLog).filter(AuditLog.resource_id == str(tag.id)).delete(
            synchronize_session=False
        )
        session.delete(tag)


@pytest.fixture()
def scratch_tag(client, monkeypatch):
    """A tag this test owns."""
    headers = _authenticate(monkeypatch)
    name = f"probe-{uuid4().hex[:8]}"
    response = client.post(
        TAGS,
        json={"name": name, "color": "#0f766e", "category": "ENGINEERING",
              "description": "Created by the tag test."},
        headers=headers,
    )
    assert response.status_code == 201, response.get_json()
    try:
        yield response.get_json()
    finally:
        _erase_tag(name)


@pytest.fixture()
def scratch_task(client, monkeypatch):
    """A task this test owns, erased on the way out."""
    from src.core.db import session_scope
    from src.models.business import Task
    from src.models.content import TagLink
    from src.models.platform import ActivityEntry, AuditLog

    headers = _authenticate(monkeypatch)
    response = client.post(
        f"{PREFIX}/api/records/task",
        json={"title": "Tag probe", "status": "NEW", "priority": "NORMAL"},
        headers=headers,
    )
    assert response.status_code == 201, response.get_json()
    record = response.get_json()
    try:
        yield record
    finally:
        with session_scope() as session:
            session.query(TagLink).filter(TagLink.resource_id == record["id"]).delete(
                synchronize_session=False
            )
            session.query(ActivityEntry).filter(
                ActivityEntry.resource_id == record["id"]
            ).delete(synchronize_session=False)
            session.query(AuditLog).filter(AuditLog.resource_id == record["id"]).delete(
                synchronize_session=False
            )
            session.query(Task).filter(Task.id == record["id"]).delete(
                synchronize_session=False
            )
