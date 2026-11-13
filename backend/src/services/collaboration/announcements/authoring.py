"""Drafts, reach, one announcement, and creating one."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import func, or_, select

from src.core.clock import now
from src.core.errors import NotFoundError
from src.core.pagination import envelope, parse_page
from src.core.query import count_of
from src.services.collaboration.announcements.serializers import _state, _visible_to
from src.services.collaboration.announcements.validation import (
    _row,
    _status,
    _validated,
)
from src.services.collaboration.announcements.vocabulary import (
    MANAGE_PERMISSION,
    STATUSES,
    _notice,
    _receipts_for,
)


def drafts(session, args, *, principal) -> dict[str, Any]:
    """Every notice, whatever its state — the author's view.

    A separate function rather than a flag on `feed`, because it is a different
    question with a different permission: `feed` answers "what am I being
    told", this answers "what have we written". A single endpoint doing both
    would be one `if` away from publishing somebody's draft.
    """
    principal.require(MANAGE_PERMISSION)
    from src.models.platform import Announcement

    page = parse_page(args, default_sort="created_at")
    moment = now()
    status = _status(args.get("status"))

    statement = select(Announcement).where(Announcement.deleted_at.is_(None))
    if principal.organization_id:
        statement = statement.where(
            or_(
                Announcement.organization_id.is_(None),
                Announcement.organization_id == principal.organization_id,
            )
        )
    if status:
        statement = statement.where(Announcement.status == status)

    ordered = statement.order_by(Announcement.created_at.desc())
    total = count_of(session, ordered)
    rows = session.scalars(ordered.offset(page.offset).limit(page.page_size)).all()
    reach = _reach_for(session, [row.id for row in rows])

    return envelope(
        # Zeros rather than a missing key for a notice nobody has read: two
        # shapes for one field is two code paths in every client that reads it.
        [
            _notice(row, None, moment=moment, reach=reach.get(row.id, _NO_REACH))
            for row in rows
        ],
        total,
        page,
        statuses=list(STATUSES),
        status=status,
        can_manage=True,
    )


#: What a notice nobody has read reached. A constant so every path returns the
#: same shape rather than sometimes omitting the field.
_NO_REACH: dict[str, int] = {"read": 0, "acknowledged": 0}


def _reach_for(session, ids: list[UUID]) -> dict[UUID, dict[str, int]]:
    """How many people have read and acknowledged each notice.

    One grouped query for the page rather than one per row: a list of twenty
    notices that issues forty counts is a list that gets slower with every
    notice ever written (§71).
    """
    if not ids:
        return {}
    from src.models.platform import AnnouncementReceipt

    rows = session.execute(
        select(
            AnnouncementReceipt.announcement_id,
            func.count(AnnouncementReceipt.read_at),
            func.count(AnnouncementReceipt.acknowledged_at),
        )
        .where(AnnouncementReceipt.announcement_id.in_(ids))
        .group_by(AnnouncementReceipt.announcement_id)
    ).all()
    return {row[0]: {"read": int(row[1]), "acknowledged": int(row[2])} for row in rows}


def get(session, announcement_id: Any, *, principal) -> dict[str, Any]:
    """One notice, with this reader's receipt on it."""
    row = _row(session, announcement_id)
    moment = now()
    if not principal.can(MANAGE_PERMISSION) and not _visible_to(row, principal, moment):
        # 404 rather than 403: telling somebody a notice exists but is not for
        # them is itself a disclosure about who is being told what.
        raise NotFoundError("That announcement does not exist.", details={"id": str(row.id)})

    receipts = _receipts_for(session, [row.id], principal)
    reach = (
        _reach_for(session, [row.id]).get(row.id, _NO_REACH)
        if principal.can(MANAGE_PERMISSION)
        else None
    )
    return _notice(row, receipts.get(row.id), moment=moment, reach=reach)


def create(session, payload: Any, *, principal) -> dict[str, Any]:
    principal.require(MANAGE_PERMISSION)
    from src.core import audit
    from src.models.platform import Announcement

    values = _validated(payload, principal=principal, partial=False)
    row = Announcement(
        **values,
        author_id=principal.user_id,
        author_label=principal.full_name,
    )
    session.add(row)
    session.flush()
    audit.record(
        session, action="CREATE", resource_type="announcement", resource_id=row.id,
        resource_label=row.title, principal=principal, after=_state(row),
    )
    return _notice(row, None, moment=now(), reach={"read": 0, "acknowledged": 0})
