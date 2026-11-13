"""A page's revisions, and restoring one."""

from __future__ import annotations

from typing import Any

from sqlalchemy import select

from src.core.clock import iso, now
from src.core.errors import NotFoundError
from src.core.pagination import parse_uuid
from src.services.collaboration.docs.blocks import EDIT, VIEW, plain_text
from src.services.collaboration.docs.links import _sync_mentions
from src.services.collaboration.docs.page_view import _page, _person, page
from src.services.collaboration.docs.page_writes import _revise


def revisions(session, page_id: Any, *, principal) -> dict[str, Any]:
    from src.models.collab import DocRevision

    principal.require(VIEW)
    row = _page(session, page_id)
    items = session.scalars(
        select(DocRevision).where(DocRevision.page_id == row.id).order_by(DocRevision.version.desc()).limit(100)
    ).all()
    return {
        "items": [
            {"id": str(item.id), "version": item.version, "title": item.title, "note": item.note,
             "author": _person(item.author), "created_at": iso(item.created_at),
             "blocks": len(item.blocks or []), "is_current": item.version == row.version}
            for item in items
        ],
        "current_version": row.version,
    }


def _revision(session, page_row, revision_id):
    from src.models.collab import DocRevision

    item = session.get(DocRevision, parse_uuid(revision_id, field="revision_id"))
    if item is None or item.page_id != page_row.id:
        raise NotFoundError("That version of the page does not exist.")
    return item


def revision(session, page_id: Any, revision_id: Any, *, principal) -> dict[str, Any]:
    principal.require(VIEW)
    row = _page(session, page_id)
    item = _revision(session, row, revision_id)
    return {"id": str(item.id), "version": item.version, "title": item.title, "blocks": list(item.blocks or []),
            "author": _person(item.author), "created_at": iso(item.created_at), "note": item.note}


def restore(session, page_id: Any, revision_id: Any, *, principal) -> dict[str, Any]:
    """Make an old version the newest one. Nothing in between is lost."""
    principal.require(EDIT)
    row = _page(session, page_id)
    item = _revision(session, row, revision_id)
    row.title = item.title
    row.blocks = list(item.blocks or [])
    row.plain_text = plain_text(row.title, row.blocks)
    row.updated_by_id = principal.user_id
    row.updated_at = now()
    row.version += 1
    _revise(session, row, principal, note=f"Restored version {item.version}", force=True)
    _sync_mentions(session, row, principal)
    session.flush()
    session.expire(row, ["updated_by"])
    return page(session, row.id, principal=principal)
