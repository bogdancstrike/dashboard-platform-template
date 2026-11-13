"""Links from a page to records, mentions kept in step, and backlinks."""

from __future__ import annotations

from typing import Any

from sqlalchemy import select

from src.core.clock import iso
from src.core.errors import ForbiddenError, NotFoundError, ValidationError
from src.core.pagination import parse_uuid
from src.core.repository import get_or_404
from src.services.collaboration.docs.blocks import EDIT, VIEW
from src.services.collaboration.docs.page_view import _links, _page


def _record_label(session, resource_type: str, resource_id: Any, principal) -> str:
    from src.services.records.explorer import resource_for

    resource = resource_for(resource_type, principal=principal)
    record = get_or_404(
        session,
        resource.model,
        parse_uuid(resource_id, field="resource_id"),
        "That record does not exist.",
        details={"resource_type": resource_type},
        live=True,
    )
    return resource.label_for(record)


def add_link(session, page_id: Any, payload: dict[str, Any], *, principal, source: str = "MANUAL") -> dict[str, Any]:
    from src.models.collab import DocLink

    principal.require(EDIT)
    row = _page(session, page_id)
    payload = payload or {}
    resource_type = str(payload.get("resource_type") or "")
    resource_id = str(parse_uuid(payload.get("resource_id"), field="resource_id"))
    label = _record_label(session, resource_type, resource_id, principal)
    existing = session.scalars(
        select(DocLink).where(DocLink.page_id == row.id, DocLink.resource_type == resource_type,
                              DocLink.resource_id == resource_id)
    ).first()
    if existing is None:
        existing = DocLink(page_id=row.id, resource_type=resource_type, resource_id=resource_id,
                           label=label, source=source, created_by_id=principal.user_id)
        session.add(existing)
    else:
        existing.label = label
        if existing.source == "MENTION" and source != "MENTION":
            existing.source = source
    session.flush()
    return {"links": _links(session, row.id)}


def remove_link(session, page_id: Any, link_id: Any, *, principal) -> dict[str, Any]:
    from src.models.collab import DocLink

    principal.require(EDIT)
    row = _page(session, page_id)
    link = session.get(DocLink, parse_uuid(link_id, field="link_id"))
    if link is None or link.page_id != row.id:
        raise NotFoundError("That link does not exist.")
    session.delete(link)
    session.flush()
    return {"links": _links(session, row.id)}


def _sync_mentions(session, row, principal) -> None:
    """Record blocks in the body are links; a removed block is a removed link."""
    from src.models.collab import DocLink

    mentioned = {
        (block["resource_type"], block["resource_id"]): block.get("label") or ""
        for block in row.blocks or [] if block.get("kind") == "record" and block.get("resource_id")
    }
    current = session.scalars(select(DocLink).where(DocLink.page_id == row.id)).all()
    have = {(link.resource_type, link.resource_id): link for link in current}
    for link in current:
        if link.source == "MENTION" and (link.resource_type, link.resource_id) not in mentioned:
            session.delete(link)
    for (resource_type, resource_id), label in mentioned.items():
        if (resource_type, resource_id) in have:
            continue
        try:
            label = _record_label(session, resource_type, resource_id, principal)
        except (NotFoundError, ValidationError, ForbiddenError):
            continue
        session.add(DocLink(page_id=row.id, resource_type=resource_type, resource_id=resource_id,
                            label=label, source="MENTION", created_by_id=principal.user_id))


def backlinks(session, args, *, principal) -> dict[str, Any]:
    """The pages that link to one record — what a record page lists."""
    from src.models.collab import DocLink, DocPage, DocSpace

    principal.require(VIEW)
    resource_type = str(args.get("resource_type") or "")
    resource_id = str(parse_uuid(args.get("resource_id"), field="resource_id"))
    rows = session.execute(
        select(DocPage, DocSpace, DocLink.source)
        .join(DocLink, DocLink.page_id == DocPage.id)
        .join(DocSpace, DocSpace.id == DocPage.space_id)
        .where(DocLink.resource_type == resource_type, DocLink.resource_id == resource_id,
               DocPage.deleted_at.is_(None), DocSpace.deleted_at.is_(None))
        .order_by(DocPage.updated_at.desc())
        .limit(50)
    ).all()
    return {
        "items": [
            {"id": str(item.id), "title": item.title, "icon": item.icon, "space": space.name,
             "space_id": str(space.id), "source": source, "updated_at": iso(item.updated_at),
             "is_meeting": item.event_id is not None}
            for item, space, source in rows
        ],
        "can_edit": principal.can(EDIT),
    }
