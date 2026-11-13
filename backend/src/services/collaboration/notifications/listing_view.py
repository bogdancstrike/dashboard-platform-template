"""The notification list, grouped or flat, and read marks."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import case, distinct, func, select
from sqlalchemy.orm import aliased

from src.core.clock import now
from src.core.errors import NotFoundError
from src.core.pagination import Page, envelope, parse_uuid
from src.core.repository import found_or_404
from src.services.collaboration.notifications.counting import (
    CATEGORIES,
    SEVERITIES,
    _base_query,
    _clauses,
    _group_key,
    counts,
    serialize,
)


def listing(session, user_id: UUID, args, page: Page) -> dict[str, Any]:
    """One page of notifications, newest first.

    `?group=true` collapses a `group_key` into one row carrying the count and
    the newest member, which is the difference between a centre people read and
    twelve copies of "assigned you a task" burying everything else.
    """
    from src.models.platform import Notification

    clauses = _clauses(user_id, args)
    if str(args.get("group") or "").lower() in ("1", "true", "yes"):
        return _grouped(session, user_id, clauses, page)

    stmt = select(Notification).where(*clauses)
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
        grouped=False,
        # Published with the list, so the filter's choices are the *server's*
        # vocabulary. A hard-coded list in the browser is a filter that goes
        # stale the day a category is added — which is exactly what happened
        # to `ALERT`.
        categories=list(CATEGORIES),
        severities=list(SEVERITIES),
        **counts(session, user_id),
    )


def _grouped(session, user_id: UUID, clauses: list, page: Page) -> dict[str, Any]:
    """One row per `group_key`: the newest member, plus how many it stands for.

    The counts ride along as window functions over the same filtered set, so
    the page is one statement rather than a query per group — the shape that
    turns a notification centre into fifty round trips as soon as it is useful.
    """
    from src.models.platform import Notification

    key = _group_key(Notification)
    ranked = (
        select(
            Notification,
            func.count().over(partition_by=key).label("group_count"),
            func.sum(case((Notification.is_read.is_(False), 1), else_=0))
            .over(partition_by=key)
            .label("group_unread"),
            func.row_number()
            .over(partition_by=key, order_by=Notification.created_at.desc())
            .label("member_rank"),
        )
        .where(*clauses)
        .subquery()
    )
    newest = aliased(Notification, ranked)

    total = session.scalar(
        select(func.count(distinct(key))).select_from(Notification).where(*clauses)
    ) or 0

    rows = session.execute(
        select(newest, ranked.c.group_count, ranked.c.group_unread)
        .where(ranked.c.member_rank == 1)
        .order_by(newest.created_at.desc())
        .offset(page.offset)
        .limit(page.page_size)
    ).all()

    items = []
    for row, group_count, group_unread in rows:
        item = serialize(row)
        item["group_count"] = int(group_count or 1)
        item["group_unread"] = int(group_unread or 0)
        items.append(item)

    # The same vocabularies as the flat listing: the filter is one control and
    # the two views must offer it the same choices.
    return envelope(
        items,
        total,
        page,
        grouped=True,
        categories=list(CATEGORIES),
        severities=list(SEVERITIES),
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
    row = found_or_404(
        session.scalars(_base_query(user_id).where(Notification.id == identifier)).first(),
        "That notification does not exist.",
    )
    row.is_read = False
    row.read_at = None
    return serialize(row)
