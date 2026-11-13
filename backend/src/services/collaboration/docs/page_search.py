"""Finding pages: full-text search and the recently edited."""

from __future__ import annotations

from typing import Any

from sqlalchemy import or_, select

from src.core.clock import iso
from src.core.pagination import parse_uuid
from src.services.collaboration.docs.blocks import VIEW
from src.services.collaboration.docs.page_view import _person


def _snippet(text: str, term: str) -> str:
    lowered = text.lower()
    at = lowered.find(term.lower())
    if at < 0:
        return text[:160]
    start = max(0, at - 60)
    end = min(len(text), at + len(term) + 100)
    return ("…" if start else "") + text[start:end].replace("\n", " ") + ("…" if end < len(text) else "")


def search(session, args, *, principal) -> dict[str, Any]:
    from src.models.collab import DocPage, DocSpace

    principal.require(VIEW)
    term = str(args.get("q") or "").strip()
    if len(term) < 2:
        return {"items": [], "total": 0, "q": term}
    like = f"%{term}%"
    clauses = [DocPage.deleted_at.is_(None), DocSpace.deleted_at.is_(None),
               or_(DocPage.title.ilike(like), DocPage.plain_text.ilike(like))]
    if args.get("space_id"):
        clauses.append(DocPage.space_id == parse_uuid(args["space_id"], field="space_id"))
    rows = session.execute(
        select(DocPage, DocSpace)
        .join(DocSpace, DocSpace.id == DocPage.space_id)
        .where(*clauses)
        # A title hit before a body hit: somebody searching for "Runbook" wants
        # the page called that, not every page that says the word.
        .order_by(DocPage.title.ilike(like).desc(), DocPage.updated_at.desc())
        .limit(40)
    ).all()
    return {
        "items": [
            {"id": str(item.id), "title": item.title, "icon": item.icon, "space": space.name,
             "space_id": str(space.id), "snippet": _snippet(item.plain_text or "", term),
             "updated_at": iso(item.updated_at)}
            for item, space in rows
        ],
        "total": len(rows),
        "q": term,
    }


def recent(session, *, principal) -> dict[str, Any]:
    from src.models.collab import DocPage, DocSpace

    principal.require(VIEW)
    rows = session.execute(
        select(DocPage, DocSpace).join(DocSpace, DocSpace.id == DocPage.space_id)
        .where(DocPage.deleted_at.is_(None), DocSpace.deleted_at.is_(None))
        .order_by(DocPage.updated_at.desc()).limit(12)
    ).all()
    return {
        "items": [
            {"id": str(item.id), "title": item.title, "icon": item.icon, "space": space.name,
             "space_id": str(space.id), "updated_at": iso(item.updated_at),
             "updated_by": _person(item.updated_by), "is_meeting": item.event_id is not None}
            for item, space in rows
        ]
    }
