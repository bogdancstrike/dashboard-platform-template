"""The notification centre (§17), and the fan-out behind the live feed.

Two things live here:

* **Reading and marking.** A list, filterable, with unread counts, and the two
  operations that actually matter — mark one, mark all.
* **Publishing.** `publish()` writes the row and hands it to whoever is
  listening on a WebSocket. Writing and delivering in one call is what stops
  the two drifting: a notification that exists in the database but never
  reached the browser is indistinguishable, from the reader's side, from one
  that was never created.

Grouping is by `group_key`. Twelve "assigned you a task" rows are one line with
a count, not twelve lines burying everything else — which is how a notification
centre becomes something people close rather than read.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import func, or_, select, update

from src.core.clock import iso, now
from src.core.errors import NotFoundError, ValidationError
from src.core.pagination import Page, envelope, parse_uuid

#: Categories the filter offers. Free strings are still accepted on write.
CATEGORIES = ("MENTION", "ASSIGNMENT", "APPROVAL", "SYSTEM", "SECURITY", "REPORT")
SEVERITIES = ("INFO", "WARNING", "CRITICAL")


def serialize(row) -> dict[str, Any]:
    return {
        "id": str(row.id),
        "category": row.category,
        "severity": row.severity,
        "title": row.title,
        "body": row.body,
        "icon": row.icon,
        "is_read": bool(row.is_read),
        "read_at": iso(row.read_at),
        "link": row.link,
        "resource_type": row.resource_type,
        "resource_id": row.resource_id,
        "actor_id": str(row.actor_id) if row.actor_id else None,
        "actor_label": row.actor_label,
        "group_key": row.group_key,
        "created_at": iso(row.created_at),
    }


def _base_query(user_id: UUID):
    from src.models.platform import Notification

    return select(Notification).where(Notification.user_id == user_id)


def counts(session, user_id: UUID) -> dict[str, Any]:
    """Unread totals — overall and per category, for the badge and the filters."""
    from src.models.platform import Notification

    unread = session.scalar(
        select(func.count())
        .select_from(Notification)
        .where(Notification.user_id == user_id, Notification.is_read.is_(False))
    ) or 0

    per_category = {
        row.category: int(row.total)
        for row in session.execute(
            select(Notification.category, func.count().label("total"))
            .where(Notification.user_id == user_id, Notification.is_read.is_(False))
            .group_by(Notification.category)
        ).all()
    }
    return {"unread": int(unread), "by_category": per_category}


def listing(session, user_id: UUID, args, page: Page) -> dict[str, Any]:
    """One page of notifications, newest first."""
    from src.models.platform import Notification

    stmt = _base_query(user_id)

    unread_only = str(args.get("unread") or "").lower() in ("1", "true", "yes")
    if unread_only:
        stmt = stmt.where(Notification.is_read.is_(False))

    category = args.get("category")
    if category:
        values = [value.strip().upper() for value in str(category).split(",") if value.strip()]
        stmt = stmt.where(Notification.category.in_(values))

    severity = args.get("severity")
    if severity:
        values = [value.strip().upper() for value in str(severity).split(",") if value.strip()]
        stmt = stmt.where(Notification.severity.in_(values))

    term = (args.get("q") or "").strip()
    if term:
        like = f"%{term}%"
        stmt = stmt.where(or_(Notification.title.ilike(like), Notification.body.ilike(like)))

    total = session.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = session.scalars(
        stmt.order_by(Notification.created_at.desc())
        .offset(page.offset)
        .limit(page.page_size)
    ).all()

    return envelope(
        [serialize(row) for row in rows],
        total,
        page,
        **counts(session, user_id),
    )


def mark_read(session, user_id: UUID, notification_id: str) -> dict[str, Any]:
    """Mark one. Scoped to the caller — reading somebody else's notification is
    not a thing an id should be able to do."""
    from src.models.platform import Notification

    identifier = parse_uuid(notification_id, field="notification_id")
    row = session.scalars(
        _base_query(user_id).where(Notification.id == identifier)
    ).first()
    if row is None:
        raise NotFoundError("That notification does not exist.")

    if not row.is_read:
        row.is_read = True
        row.read_at = now()
    return serialize(row)


def mark_unread(session, user_id: UUID, notification_id: str) -> dict[str, Any]:
    from src.models.platform import Notification

    identifier = parse_uuid(notification_id, field="notification_id")
    row = session.scalars(_base_query(user_id).where(Notification.id == identifier)).first()
    if row is None:
        raise NotFoundError("That notification does not exist.")
    row.is_read = False
    row.read_at = None
    return serialize(row)


def mark_all_read(session, user_id: UUID, *, category: str | None = None) -> dict[str, Any]:
    """Mark everything, or everything in one category.

    A single UPDATE rather than a read-then-write loop: somebody with two
    thousand unread rows should not pay for two thousand round trips, and the
    count they see afterwards should be the count that actually applied.
    """
    from src.models.platform import Notification

    moment = now()
    stmt = (
        update(Notification)
        .where(Notification.user_id == user_id, Notification.is_read.is_(False))
        .values(is_read=True, read_at=moment)
    )
    if category:
        values = [value.strip().upper() for value in str(category).split(",") if value.strip()]
        if not values:
            raise ValidationError("category must not be empty when given")
        stmt = stmt.where(Notification.category.in_(values))

    result = session.execute(stmt)
    return {"marked": int(result.rowcount or 0), "read_at": iso(moment)}


def delete(session, user_id: UUID, notification_id: str) -> dict[str, Any]:
    from src.models.platform import Notification

    identifier = parse_uuid(notification_id, field="notification_id")
    row = session.scalars(_base_query(user_id).where(Notification.id == identifier)).first()
    if row is None:
        raise NotFoundError("That notification does not exist.")
    session.delete(row)
    return {"deleted": str(identifier)}


# ── publishing ───────────────────────────────────────────────────────────


def publish(
    session,
    *,
    user_id: UUID,
    title: str,
    category: str = "SYSTEM",
    severity: str = "INFO",
    body: str = "",
    link: str | None = None,
    icon: str | None = None,
    resource_type: str | None = None,
    resource_id: str | None = None,
    actor=None,
    group_key: str | None = None,
    metadata: dict[str, Any] | None = None,
):
    """Write one notification and hand it to any live listener.

    Takes the caller's session so the notification commits with the change that
    caused it. A notification for an update that then rolled back is a
    notification about something that never happened.
    """
    from src.models.platform import Notification

    row = Notification(
        user_id=user_id,
        category=category,
        severity=severity,
        title=title,
        body=body or None,
        icon=icon,
        link=link,
        resource_type=resource_type,
        resource_id=str(resource_id) if resource_id else None,
        actor_id=getattr(actor, "user_id", None),
        actor_label=getattr(actor, "full_name", None),
        group_key=group_key or f"{category.lower()}:{resource_type or 'system'}",
        metadata_json=metadata or None,
        created_at=now(),
    )
    session.add(row)
    session.flush()

    # Delivery is deliberately after the flush and deliberately best-effort:
    # a browser that is not listening must never fail the write that caused
    # the notification.
    from src.services import live

    live.publish_to_user(user_id, {"type": "notification", "data": serialize(row)})
    return row
