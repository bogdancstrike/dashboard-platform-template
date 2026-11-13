"""Spaces: list, create, change, delete, and the page tree."""

from __future__ import annotations

import re
from typing import Any

from sqlalchemy import func, select

from src.core.clock import iso, now
from src.core.errors import ConflictError, ForbiddenError, ValidationError
from src.core.pagination import parse_uuid
from src.core.repository import get_or_404
from src.services.collaboration.docs.blocks import EDIT, VIEW, _text


def _space(session, space_id: Any):
    from src.models.collab import DocSpace

    row = get_or_404(
        session,
        DocSpace,
        parse_uuid(space_id, field="space_id"),
        "That space does not exist.",
        live=True,
    )
    return row


def _space_dict(row, pages: int = 0) -> dict[str, Any]:
    return {
        "id": str(row.id),
        "key": row.key,
        "name": row.name,
        "description": row.description,
        "icon": row.icon,
        "color": row.color,
        "kind": row.kind,
        "page_count": pages,
    }


def spaces(session, *, principal) -> dict[str, Any]:
    from src.models.collab import DocPage, DocSpace

    principal.require(VIEW)
    counts = dict(
        session.execute(
            select(DocPage.space_id, func.count()).where(DocPage.deleted_at.is_(None)).group_by(DocPage.space_id)
        ).all()
    )
    rows = session.scalars(
        select(DocSpace).where(DocSpace.deleted_at.is_(None)).order_by(DocSpace.position, DocSpace.name)
    ).all()
    return {
        "items": [_space_dict(row, int(counts.get(row.id, 0))) for row in rows],
        "can_edit": principal.can(EDIT),
    }


def _space_key(raw: Any) -> str:
    key = re.sub(r"[^a-z0-9]+", "-", str(raw or "").lower()).strip("-")[:48]
    if not key:
        raise ValidationError("A space needs a name.", details={"field": "name"})
    return key


def create_space(session, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    from src.models.collab import DocSpace

    principal.require(EDIT)
    payload = payload or {}
    name = _text(payload.get("name"), "name", limit=120).strip()
    key = _space_key(payload.get("key") or name)
    if session.scalar(select(func.count()).select_from(DocSpace).where(DocSpace.key == key)):
        raise ConflictError("There is already a space with that name.", details={"field": "name"})
    top = session.scalar(select(func.max(DocSpace.position))) or 0
    row = DocSpace(
        key=key, name=name, description=_text(payload.get("description"), "description", limit=400) or None,
        icon=_text(payload.get("icon"), "icon", limit=16) or "📚",
        color=_text(payload.get("color"), "color", limit=16) or "#2457D6",
        position=top + 1024, created_by_id=principal.user_id,
    )
    session.add(row)
    session.flush()
    return _space_dict(row)


def update_space(session, space_id: Any, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    principal.require(EDIT)
    row = _space(session, space_id)
    payload = payload or {}
    if "name" in payload:
        name = _text(payload.get("name"), "name", limit=120).strip()
        if not name:
            raise ValidationError("A space needs a name.", details={"field": "name"})
        row.name = name
    if "description" in payload:
        row.description = _text(payload.get("description"), "description", limit=400) or None
    if "icon" in payload:
        row.icon = _text(payload.get("icon"), "icon", limit=16) or None
    session.flush()
    return _space_dict(row)


def delete_space(session, space_id: Any, *, principal) -> dict[str, Any]:
    principal.require(EDIT)
    row = _space(session, space_id)
    if not principal.is_admin and row.created_by_id != principal.user_id:
        raise ForbiddenError("Only whoever made a space, or an administrator, can remove it.")
    if row.kind == "MEETINGS":
        raise ConflictError("The Meetings space is where notes are filed; it cannot be removed.")
    row.deleted_at = now()
    session.flush()
    return {"deleted": True, "id": str(row.id)}


def tree(session, space_id: Any, *, principal) -> dict[str, Any]:
    """Every page in a space, flat, with its parent — the browser builds the tree."""
    from src.models.collab import DocPage

    principal.require(VIEW)
    space = _space(session, space_id)
    rows = session.execute(
        select(DocPage.id, DocPage.parent_id, DocPage.title, DocPage.icon, DocPage.position,
               DocPage.updated_at, DocPage.event_id)
        .where(DocPage.space_id == space.id, DocPage.deleted_at.is_(None))
        .order_by(DocPage.position, DocPage.title)
    ).all()
    return {
        "space": _space_dict(space, len(rows)),
        "items": [
            {
                "id": str(page_id), "parent_id": str(parent) if parent else None, "title": title,
                "icon": icon, "position": position, "updated_at": iso(updated),
                "is_meeting": event is not None,
            }
            for page_id, parent, title, icon, position, updated, event in rows
        ],
    }
