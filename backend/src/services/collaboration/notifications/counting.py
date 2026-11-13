"""Notification categories, the badge hook, counts and filters."""

from __future__ import annotations

from datetime import timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import String, cast, func, or_, select

from src.core import vocabulary
from src.core.clock import iso, now
from src.core.errors import ValidationError
from src.core.events import Hook

#: Categories the filter offers. Free strings are still accepted on write.
#: Read from `core/vocabulary` rather than written here. These two lists were
#: in three places — this module, the seed's catalogue and a constant in the
#: frontend — and `ALERT` had been added to none of them, so every
#: notification an automation sent was unfilterable.
CATEGORIES = vocabulary.NOTIFICATION_CATEGORY


SEVERITIES = vocabulary.NOTIFICATION_SEVERITY


#: `(session, user_id) -> dict` — extra menu badges for the summary poll.
badges = Hook("notifications.badges")


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
    """Unread totals for the badge, the filters and the centre's digest.

    Counted in SQL rather than derived from the loaded page. The centre shows
    twenty-five rows of a possible three hundred, so "4 critical" computed in
    the browser would mean "4 critical *on this page*" — a number that is
    wrong exactly when it matters, which is when there are many.
    """
    from src.models.platform import Notification

    mine = (Notification.user_id == user_id, Notification.is_read.is_(False))

    unread = session.scalar(
        select(func.count()).select_from(Notification).where(*mine)
    ) or 0

    def _grouped(column) -> dict[str, int]:
        return {
            row[0]: int(row[1])
            for row in session.execute(
                select(column, func.count()).where(*mine).group_by(column)
            ).all()
        }

    # "Since midnight" in the reader's day is a client concern; this is the
    # last 24 hours, which is what "today" means to somebody who has just
    # arrived at work and is the only version the server can answer honestly
    # without knowing their timezone.
    since = now() - timedelta(hours=24)
    recent = session.scalar(
        select(func.count())
        .select_from(Notification)
        .where(*mine, Notification.created_at >= since)
    ) or 0

    return {
        "unread": int(unread),
        "by_category": _grouped(Notification.category),
        "by_severity": _grouped(Notification.severity),
        "recent": int(recent),
        # Other menu badges ride on the same poll: the approvals inbox (Time &
        # decisions) and chat (§47) connect to `badges`.
        **{key: value for answer in badges.emit(session, user_id) for key, value in answer.items()},
    }


def _clauses(user_id: UUID, args) -> list:
    """Every filter the notification centre offers, as SQL predicates.

    Shared by the flat listing and the grouped one so the two can never
    disagree about what the current filter selects — a grouped view that
    counts rows the flat view excludes is a grouped view nobody believes.
    """
    from src.models.platform import Notification

    clauses = [Notification.user_id == user_id]

    read_state = str(args.get("read") or "").strip().lower()
    if str(args.get("unread") or "").lower() in ("1", "true", "yes") or read_state == "unread":
        clauses.append(Notification.is_read.is_(False))
    elif read_state == "read":
        clauses.append(Notification.is_read.is_(True))
    elif read_state not in ("", "all"):
        raise ValidationError("read must be one of: all, read, unread")

    category = args.get("category")
    if category:
        values = [value.strip().upper() for value in str(category).split(",") if value.strip()]
        clauses.append(Notification.category.in_(values))

    severity = args.get("severity")
    if severity:
        values = [value.strip().upper() for value in str(severity).split(",") if value.strip()]
        clauses.append(Notification.severity.in_(values))

    group_key = args.get("group_key")
    if group_key:
        clauses.append(Notification.group_key == str(group_key))

    term = (args.get("q") or "").strip()
    if term:
        like = f"%{term}%"
        clauses.append(or_(Notification.title.ilike(like), Notification.body.ilike(like)))

    return clauses


def _group_key(model):
    """The value rows are collapsed on.

    A row with no `group_key` is its own group rather than joining a single
    enormous "ungrouped" pile — falling back to the id is what keeps a
    one-of-a-kind notice visible instead of hidden behind a count.
    """
    return func.coalesce(model.group_key, cast(model.id, String))
