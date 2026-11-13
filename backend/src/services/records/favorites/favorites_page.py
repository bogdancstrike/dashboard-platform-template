"""The favourites page: list, add, remove, arrange."""

from __future__ import annotations

from typing import Any

from sqlalchemy import select

from src.core import audit
from src.core.clock import iso
from src.core.errors import NotFoundError, ValidationError
from src.core.pagination import parse_uuid
from src.models.personal import Favorite
from src.services.records.favorites.favorite_state import (
    MAX_FAVORITES,
    bookmarkable,
    set_favorite,
)


def _serialise(row) -> dict[str, Any]:
    return {
        "id": str(row.id),
        "resource_type": row.resource_type,
        "resource_id": row.resource_id,
        "label": row.label,
        # Stored, so it survives a record being renamed and a route changing
        # shape for new records only.
        "url": row.url,
        "icon": row.icon,
        "position": row.position,
        "added_at": iso(row.created_at),
    }


def listing(session, *, principal) -> dict[str, Any]:
    """Every bookmark, in the order this person arranged them."""
    rows = session.scalars(
        select(Favorite)
        .where(Favorite.user_id == principal.user_id)
        .order_by(Favorite.position.asc(), Favorite.created_at.asc())
    ).all()

    listed = [_serialise(row) for row in rows]
    # Counted per type so the page can group them, and derived here rather
    # than in the browser so the number and the rows cannot disagree (§71).
    kinds: dict[str, int] = {}
    for item in listed:
        kinds[item["resource_type"]] = kinds.get(item["resource_type"], 0) + 1

    return {
        "items": listed,
        "total": len(listed),
        "maximum": MAX_FAVORITES,
        "kinds": [{"key": key, "count": kinds[key]} for key in sorted(kinds)],
        "bookmarkable": list(bookmarkable()),
    }


def add(session, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    """Bookmark something. The generic path, for anything with an address."""
    body = payload if isinstance(payload, dict) else {}
    resource_type = str(body.get("resource_type") or "").strip()
    resource_id = str(body.get("resource_id") or "").strip()
    label = str(body.get("label") or "").strip()
    url = str(body.get("url") or "").strip()

    if resource_type not in bookmarkable():
        raise ValidationError(
            "That is not something this platform can bookmark.",
            details={"resource_type": resource_type, "available": list(bookmarkable())},
        )
    if not resource_id or not label or not url:
        raise ValidationError(
            "A bookmark needs something to point at, a name and an address.",
            details={
                "missing": [
                    name
                    for name, value in (
                        ("resource_id", resource_id),
                        ("label", label),
                        ("url", url),
                    )
                    if not value
                ]
            },
        )
    if not url.startswith("/"):
        # An in-app route, never an absolute address: a "favourite" that
        # navigated off the platform would be a link nobody expects (§76).
        raise ValidationError(
            "A bookmark points at a page in this application.",
            details={"url": url},
        )

    set_favorite(
        session,
        principal,
        resource_type=resource_type,
        resource_id=resource_id,
        label=label,
        url=url,
        icon=str(body.get("icon") or ""),
        wanted=True,
    )
    audit.record(
        session,
        action="favorite.add",
        resource_type="favorite",
        resource_id=resource_id,
        resource_label=label,
        principal=principal,
        after={"resource_type": resource_type, "url": url},
        # One activity entry per bookmark would drown a feed in "starred a
        # ticket" (§48).
        activity=False,
    )
    session.commit()
    return listing(session, principal=principal)


def remove(session, ident: Any, *, principal) -> dict[str, Any]:
    """Unstar one thing."""
    row = session.get(Favorite, parse_uuid(ident, field="favorite id"))
    if row is None or row.user_id != principal.user_id:
        raise NotFoundError("That favourite does not exist.", details={"id": str(ident)})

    label = row.label
    resource_id = row.resource_id
    session.delete(row)
    session.flush()
    audit.record(
        session,
        action="favorite.remove",
        resource_type="favorite",
        resource_id=resource_id,
        resource_label=label,
        principal=principal,
        activity=False,
    )
    session.commit()
    return listing(session, principal=principal)


def arrange(session, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    """Put the bookmarks in the order somebody dragged them into.

    The whole list at once rather than a move-one call: a shortcut bar is
    rearranged by dragging, and applying that as a series of single moves is
    how two drags end up fighting over one position.
    """
    body = payload if isinstance(payload, dict) else {}
    order = body.get("order")
    if not isinstance(order, list) or not order:
        raise ValidationError("The order must be a list of favourite ids.")

    rows = {
        str(row.id): row
        for row in session.scalars(
            select(Favorite).where(Favorite.user_id == principal.user_id)
        )
    }
    unknown = [str(item) for item in order if str(item) not in rows]
    if unknown:
        # A stale list from a page that has not refreshed. Refused rather than
        # partially applied, because half an arrangement is worse than none.
        raise ValidationError(
            "Those favourites are not yours, or no longer exist.",
            details={"ids": unknown},
        )

    for position, item in enumerate(order, start=1):
        rows[str(item)].position = position
    # Anything the page did not mention keeps its place after the named ones,
    # so a partial list cannot silently reshuffle the rest.
    for row in rows.values():
        if str(row.id) not in {str(item) for item in order}:
            row.position = len(order) + row.position

    session.commit()
    return listing(session, principal=principal)
