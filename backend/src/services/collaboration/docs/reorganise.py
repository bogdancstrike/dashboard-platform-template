"""Deleting and moving pages, their descendants with them."""

from __future__ import annotations

from typing import Any

from sqlalchemy import select

from src.core.clock import now
from src.core.errors import ValidationError
from src.services.collaboration.docs.blocks import EDIT
from src.services.collaboration.docs.page_view import _page
from src.services.collaboration.docs.wiki_spaces import _space


def _descendants(session, page_id) -> list[Any]:
    from src.models.collab import DocPage

    found: list[Any] = []
    frontier = [page_id]
    while frontier:
        children = session.scalars(
            select(DocPage.id).where(DocPage.parent_id.in_(frontier), DocPage.deleted_at.is_(None))
        ).all()
        found.extend(children)
        frontier = list(children)
    return found


def delete_page(session, page_id: Any, *, principal) -> dict[str, Any]:
    """Withdraw a page and everything under it. Soft: history stays readable."""
    from src.models.collab import DocPage

    principal.require(EDIT)
    row = _page(session, page_id)
    moment = now()
    ids = [row.id, *_descendants(session, row.id)]
    for item in session.scalars(select(DocPage).where(DocPage.id.in_(ids))).all():
        item.deleted_at = moment
    session.flush()
    return {"deleted": len(ids), "id": str(row.id)}


def move_page(session, page_id: Any, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    """Put a page under a new parent and/or between two siblings.

    `before_id` / `after_id` name the sibling it lands next to; the position
    becomes the midpoint, so a drag writes one row.
    """
    from src.models.collab import DocPage

    principal.require(EDIT)
    row = _page(session, page_id)
    payload = payload or {}
    space_id = row.space_id
    if payload.get("space_id"):
        space_id = _space(session, payload["space_id"]).id
    parent_id = None
    if payload.get("parent_id"):
        parent = _page(session, payload["parent_id"])
        if parent.id == row.id or parent.id in _descendants(session, row.id):
            raise ValidationError("A page cannot be moved inside itself.", details={"field": "parent_id"})
        parent_id = parent.id
        space_id = parent.space_id

    def sibling(key: str):
        if not payload.get(key):
            return None
        other = _page(session, payload[key])
        if other.parent_id != parent_id:
            raise ValidationError("The neighbour must share the new parent.", details={"field": key})
        return other

    before, after = sibling("before_id"), sibling("after_id")
    siblings = session.scalars(
        select(DocPage).where(
            DocPage.space_id == space_id, DocPage.deleted_at.is_(None), DocPage.id != row.id,
            DocPage.parent_id.is_(None) if parent_id is None else DocPage.parent_id == parent_id,
        ).order_by(DocPage.position)
    ).all()
    if before is not None:
        index = next(i for i, item in enumerate(siblings) if item.id == before.id)
        lower = siblings[index - 1].position if index > 0 else before.position - 2048
        position = (lower + before.position) / 2
    elif after is not None:
        index = next(i for i, item in enumerate(siblings) if item.id == after.id)
        upper = siblings[index + 1].position if index + 1 < len(siblings) else after.position + 2048
        position = (after.position + upper) / 2
    else:
        position = (siblings[-1].position if siblings else 0) + 1024

    moving = [row.id, *_descendants(session, row.id)]
    for item in session.scalars(select(DocPage).where(DocPage.id.in_(moving))).all():
        item.space_id = space_id
    row.parent_id = parent_id
    row.position = position
    session.flush()
    return {"id": str(row.id), "parent_id": str(parent_id) if parent_id else None,
            "space_id": str(space_id), "position": position}
