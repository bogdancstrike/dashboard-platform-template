"""Recently visited records."""

from __future__ import annotations

from typing import Any

from sqlalchemy import select

from src.core import audit
from src.core.clock import iso, now
from src.core.errors import ValidationError
from src.models.personal import Favorite, RecentItem
from src.services.records.favorites.favorite_state import MAX_RECENTS


def recents(session, *, principal) -> dict[str, Any]:
    """What this person has looked at lately, most recent first."""
    rows = session.scalars(
        select(RecentItem)
        .where(RecentItem.user_id == principal.user_id)
        .order_by(RecentItem.visited_at.desc())
        .limit(MAX_RECENTS)
    ).all()

    starred = {
        (row.resource_type, row.resource_id)
        for row in session.scalars(
            select(Favorite).where(Favorite.user_id == principal.user_id)
        )
    }

    return {
        "items": [
            {
                "id": str(row.id),
                "resource_type": row.resource_type,
                "resource_id": row.resource_id,
                "label": row.label,
                "url": row.url,
                "icon": row.icon,
                "visited_at": iso(row.visited_at),
                # "How often" is what separates a place somebody works from
                # one they wandered into once.
                "visit_count": row.visit_count,
                # So the page can offer "star this" on a recent without a
                # second request per row.
                "is_favorite": (row.resource_type, row.resource_id) in starred,
            }
            for row in rows
        ],
        "total": len(rows),
        "kept": MAX_RECENTS,
    }


def visit(session, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    """Record that this person looked at something.

    Upserted on `(user, type, id)` — the table's own unique constraint — so a
    place somebody works accumulates a visit count rather than fifty rows.
    Trimmed to `MAX_RECENTS`, because a recents list is a by-product and an
    unbounded by-product is a table that only grows.
    """
    body = payload if isinstance(payload, dict) else {}
    resource_type = str(body.get("resource_type") or "").strip()
    resource_id = str(body.get("resource_id") or "").strip()
    label = str(body.get("label") or "").strip()
    url = str(body.get("url") or "").strip()

    if not (resource_type and resource_id and label and url):
        raise ValidationError("A visit needs a type, an id, a name and an address.")

    row = session.scalar(
        select(RecentItem).where(
            RecentItem.user_id == principal.user_id,
            RecentItem.resource_type == resource_type,
            RecentItem.resource_id == resource_id,
        )
    )
    moment = now()
    if row is None:
        session.add(
            RecentItem(
                user_id=principal.user_id,
                resource_type=resource_type,
                resource_id=resource_id,
                label=label[:240],
                url=url[:500],
                icon=str(body.get("icon") or "") or None,
                visited_at=moment,
                visit_count=1,
            )
        )
    else:
        row.visited_at = moment
        row.visit_count += 1
        # Kept fresh, so a renamed record does not sit in the list under its
        # old name.
        row.label = label[:240] or row.label
        row.url = url[:500] or row.url

    session.flush()
    _trim_recents(session, principal)
    session.commit()
    return recents(session, principal=principal)


def _trim_recents(session, principal) -> None:
    """Keep the newest `MAX_RECENTS` and drop the rest."""
    keep = [
        row[0]
        for row in session.execute(
            select(RecentItem.id)
            .where(RecentItem.user_id == principal.user_id)
            .order_by(RecentItem.visited_at.desc())
            .limit(MAX_RECENTS)
        ).all()
    ]
    if not keep:
        return
    stale = session.scalars(
        select(RecentItem).where(
            RecentItem.user_id == principal.user_id, RecentItem.id.notin_(keep)
        )
    ).all()
    for row in stale:
        session.delete(row)
    if stale:
        session.flush()


def clear_recents(session, *, principal) -> dict[str, Any]:
    """Forget what this person has looked at.

    All of it or none: a recents list is a trail, and removing one entry from
    a trail leaves a misleading one. Bookmarks are untouched, because those
    were a decision rather than a by-product.
    """
    rows = session.scalars(
        select(RecentItem).where(RecentItem.user_id == principal.user_id)
    ).all()
    for row in rows:
        session.delete(row)

    if rows:
        audit.record(
            session,
            action="recents.clear",
            resource_type="recent",
            resource_id=principal.user_id,
            resource_label=f"{len(rows)} items",
            principal=principal,
            activity=False,
        )
    session.commit()
    return {"cleared": len(rows), **recents(session, principal=principal)}
