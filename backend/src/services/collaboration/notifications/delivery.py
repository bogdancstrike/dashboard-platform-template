"""Marking all read, deleting, and publishing a notification."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import update

from src.core.clock import iso, now
from src.core.errors import ValidationError
from src.core.pagination import parse_uuid
from src.core.repository import found_or_404
from src.services.collaboration.notifications.counting import (
    _base_query,
    _group_key,
    serialize,
)


def mark_all_read(
    session,
    user_id: UUID,
    *,
    category: str | None = None,
    group_key: str | None = None,
) -> dict[str, Any]:
    """Mark everything, everything in one category, or one collapsed group.

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
    if group_key:
        # The grouped view collapses on the key *or* the id when there is none,
        # so dismissing a group has to accept both spellings — otherwise the
        # one-of-a-kind rows the view shows cannot be dismissed from it.
        stmt = stmt.where(_group_key(Notification) == str(group_key))

    result = session.execute(stmt)
    return {"marked": int(result.rowcount or 0), "read_at": iso(moment)}


def delete(session, user_id: UUID, notification_id: str) -> dict[str, Any]:
    from src.models.platform import Notification

    identifier = parse_uuid(notification_id, field="notification_id")
    row = found_or_404(
        session.scalars(_base_query(user_id).where(Notification.id == identifier)).first(),
        "That notification does not exist.",
    )
    session.delete(row)
    return {"deleted": str(identifier)}


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
    from src.services.collaboration import live

    live.publish_to_user(user_id, {"type": "notification", "data": serialize(row)})
    return row
