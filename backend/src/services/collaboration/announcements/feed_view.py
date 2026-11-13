"""Announcement categories and severities, and the reader's feed."""

from __future__ import annotations

from typing import Any

from sqlalchemy import func, or_, select

from src.core.clock import now
from src.core.pagination import envelope, parse_page
from src.core.query import count_of
from src.services.collaboration.announcements.vocabulary import (
    CATEGORIES,
    MANAGE_PERMISSION,
    _audience_clause,
    _category,
    _live_clause,
    _notice,
    _receipts_for,
    _unread_count,
)


def feed(session, args, *, principal) -> dict[str, Any]:
    """The notices this reader should see, newest and most urgent first.

    Includes what has expired only when asked for: a maintenance window that
    has passed is history, and history is worth being able to look up without
    being shown it every morning.
    """
    from src.models.platform import Announcement, AnnouncementReceipt

    page = parse_page(args, default_sort="publish_at")
    moment = now()
    category = _category(args.get("category"))
    include_expired = str(args.get("include_expired") or "").lower() in ("1", "true", "yes")
    unread_only = str(args.get("unread") or "").lower() in ("1", "true", "yes")

    statement = select(Announcement).where(
        Announcement.deleted_at.is_(None),
        _audience_clause(Announcement, principal),
    )
    if include_expired:
        # Everything that was ever published to this reader, live or not —
        # never drafts, which are their author's business.
        statement = statement.where(
            Announcement.status.in_(("PUBLISHED", "ARCHIVED")),
            or_(Announcement.publish_at.is_(None), Announcement.publish_at <= moment),
        )
    else:
        statement = statement.where(_live_clause(Announcement, moment))
    if category:
        statement = statement.where(Announcement.category == category)

    if unread_only:
        # A correlated NOT EXISTS rather than a join: a reader with no receipts
        # at all must see everything, which an inner join would hide.
        seen = (
            select(AnnouncementReceipt.id)
            .where(
                AnnouncementReceipt.announcement_id == Announcement.id,
                AnnouncementReceipt.user_id == principal.user_id,
                AnnouncementReceipt.read_at.is_not(None),
            )
            .exists()
        )
        statement = statement.where(~seen)

    ordered = statement.order_by(
        # Pinned first, then the newest. The pin is what an operator has said
        # matters more than recency, and recency is the tiebreak.
        Announcement.is_pinned.desc(),
        Announcement.publish_at.desc().nullslast(),
        Announcement.created_at.desc(),
    )
    total = count_of(session, ordered)
    rows = session.scalars(ordered.offset(page.offset).limit(page.page_size)).all()

    receipts = _receipts_for(session, [row.id for row in rows], principal)

    return envelope(
        [_notice(row, receipts.get(row.id), moment=moment) for row in rows],
        total,
        page,
        categories=[
            {"key": key, "label": label, "count": count}
            for key, label, count in _category_counts(session, principal, moment)
        ],
        unread=_unread_count(session, principal, moment),
        can_manage=principal.can(MANAGE_PERMISSION),
        category=category,
        include_expired=include_expired,
    )


def _category_counts(session, principal, moment):
    """A count per category over what is live for this reader.

    The server's, over the whole match — a strip counting the page it returned
    would say "of the twenty I sent" (§71). Every declared category is
    returned, at zero when there is nothing: a chip that vanishes teaches a
    reader that the platform has stopped publishing releases.
    """
    from src.models.platform import Announcement

    counted = dict(
        session.execute(
            select(Announcement.category, func.count())
            .where(
                Announcement.deleted_at.is_(None),
                _audience_clause(Announcement, principal),
                _live_clause(Announcement, moment),
            )
            .group_by(Announcement.category)
        ).all()
    )
    return [(key, label, int(counted.get(key, 0))) for key, label in CATEGORIES]
