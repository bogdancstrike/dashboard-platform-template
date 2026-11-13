"""Creating, revising, deleting and moving pages."""

from __future__ import annotations

from datetime import timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import func, select

from src.core.clock import now
from src.core.errors import ConflictError, ValidationError
from src.services.collaboration.docs.blocks import (
    COALESCE_MINUTES,
    EDIT,
    _text,
    _title,
    clean_blocks,
    plain_text,
)
from src.services.collaboration.docs.links import _sync_mentions
from src.services.collaboration.docs.page_templates import TEMPLATES, _template_blocks
from src.services.collaboration.docs.page_view import _page, page
from src.services.collaboration.docs.wiki_spaces import _space


def _next_position(session, space_id, parent_id) -> float:
    from src.models.collab import DocPage

    top = session.scalar(
        select(func.max(DocPage.position)).where(
            DocPage.space_id == space_id,
            DocPage.parent_id.is_(None) if parent_id is None else DocPage.parent_id == parent_id,
            DocPage.deleted_at.is_(None),
        )
    )
    return float(top or 0) + 1024


def create_page(session, payload: dict[str, Any], *, principal, event_id: UUID | None = None) -> dict[str, Any]:
    from src.models.collab import DocPage

    principal.require(EDIT)
    payload = payload or {}
    space = _space(session, payload.get("space_id"))
    parent = None
    if payload.get("parent_id"):
        parent = _page(session, payload["parent_id"])
        if parent.space_id != space.id:
            raise ValidationError("A page's parent must be in the same space.", details={"field": "parent_id"})
    template = str(payload.get("template") or "") or None
    if template and template not in {item["key"] for item in TEMPLATES}:
        raise ValidationError("That template does not exist.", details={"field": "template"})
    blocks = clean_blocks(payload["blocks"]) if "blocks" in payload else clean_blocks(
        _template_blocks(template or "blank")
    )
    title = _title(payload.get("title") or next(
        (item["name"] for item in TEMPLATES if item["key"] == template and template != "blank"), "Untitled"
    ))
    row = DocPage(
        space_id=space.id, parent_id=parent.id if parent else None, title=title,
        icon=_text(payload.get("icon"), "icon", limit=16) or None,
        position=_next_position(session, space.id, parent.id if parent else None),
        blocks=blocks, plain_text=plain_text(title, blocks), version=1, template=template,
        event_id=event_id, created_by_id=principal.user_id, updated_by_id=principal.user_id,
    )
    session.add(row)
    session.flush()
    _revise(session, row, principal, note="Created")
    _sync_mentions(session, row, principal)
    session.flush()
    return page(session, row.id, principal=principal)


def _revise(session, row, principal, *, note: str | None = None, force: bool = False) -> None:
    """Record the page as it now stands — or fold this save into the last one."""
    from src.models.collab import DocRevision

    latest = session.scalars(
        select(DocRevision).where(DocRevision.page_id == row.id).order_by(DocRevision.version.desc()).limit(1)
    ).first()
    moment = now()
    if (
        not force and latest is not None and latest.author_id == principal.user_id
        and latest.version == row.version
        and latest.created_at > moment - timedelta(minutes=COALESCE_MINUTES)
    ):
        latest.title = row.title
        latest.blocks = list(row.blocks or [])
        latest.created_at = moment
        return
    if latest is not None and latest.version >= row.version:
        row.version = latest.version + 1
    session.add(DocRevision(
        page_id=row.id, version=row.version, title=row.title, blocks=list(row.blocks or []),
        note=note, author_id=principal.user_id, created_at=moment,
    ))


def update_page(session, page_id: Any, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    principal.require(EDIT)
    row = _page(session, page_id)
    payload = payload or {}
    expected = payload.get("expected_version")
    if expected is not None and int(expected) != row.version:
        raise ConflictError(
            "Somebody else saved this page while you were editing it.",
            details={"version": row.version, "expected_version": expected},
        )
    if "title" in payload:
        row.title = _title(payload.get("title"))
    if "icon" in payload:
        row.icon = _text(payload.get("icon"), "icon", limit=16) or None
    if "blocks" in payload:
        row.blocks = clean_blocks(payload.get("blocks"))
    row.plain_text = plain_text(row.title, list(row.blocks or []))
    row.updated_by_id = principal.user_id
    row.updated_at = now()
    _revise(session, row, principal, note=payload.get("note"))
    _sync_mentions(session, row, principal)
    session.flush()
    session.expire(row, ["updated_by"])
    return page(session, row.id, principal=principal)
