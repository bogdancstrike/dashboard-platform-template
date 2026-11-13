"""Changing, removing and acknowledging announcements."""

from __future__ import annotations

from typing import Any

from sqlalchemy import select

from src.core.clock import now
from src.core.errors import NotFoundError, ValidationError
from src.services.collaboration.announcements.authoring import _NO_REACH, _reach_for
from src.services.collaboration.announcements.serializers import _state, _visible_to
from src.services.collaboration.announcements.validation import _row, _validated
from src.services.collaboration.announcements.vocabulary import (
    MANAGE_PERMISSION,
    _notice,
)


def update(session, announcement_id: Any, payload: Any, *, principal) -> dict[str, Any]:
    principal.require(MANAGE_PERMISSION)
    from src.core import audit

    row = _row(session, announcement_id)
    values = _validated(payload, principal=principal, partial=True)
    before = _state(row)
    for key, value in values.items():
        setattr(row, key, value)
    session.flush()
    audit.record(
        session, action="UPDATE", resource_type="announcement", resource_id=row.id,
        resource_label=row.title, principal=principal, before=before, after=_state(row),
    )
    return _notice(
        row, None, moment=now(), reach=_reach_for(session, [row.id]).get(row.id, _NO_REACH)
    )


def remove(session, announcement_id: Any, *, principal) -> dict[str, Any]:
    principal.require(MANAGE_PERMISSION)
    from src.core import audit

    row = _row(session, announcement_id)
    # Soft, like every other record: a notice that was published and then
    # deleted is something people remember receiving, and the audit trail has
    # to be able to point at it.
    row.deleted_at = now()
    session.flush()
    audit.record(
        session, action="DELETE", resource_type="announcement", resource_id=row.id,
        resource_label=row.title, principal=principal,
    )
    return {"id": str(row.id), "title": row.title, "deleted": True}


def mark(session, announcement_id: Any, payload: Any, *, principal) -> dict[str, Any]:
    """Record that this reader has read — or acknowledged — this notice.

    Upserted on the reader's action rather than written at publish time, and
    idempotent: a page that marks on render will send this more than once, and
    the second one must not move the timestamp the first one recorded.
    """
    from src.models.platform import AnnouncementReceipt

    row = _row(session, announcement_id)
    moment = now()
    if not _visible_to(row, principal, moment):
        raise NotFoundError("That announcement does not exist.", details={"id": str(row.id)})

    body = payload if isinstance(payload, dict) else {}
    acknowledge = bool(body.get("acknowledged"))
    if acknowledge and not row.requires_acknowledgement:
        raise ValidationError(
            "That announcement does not ask to be acknowledged.",
            details={"id": str(row.id)},
        )

    receipt = session.scalars(
        select(AnnouncementReceipt).where(
            AnnouncementReceipt.announcement_id == row.id,
            AnnouncementReceipt.user_id == principal.user_id,
        )
    ).one_or_none()
    if receipt is None:
        receipt = AnnouncementReceipt(announcement_id=row.id, user_id=principal.user_id)
        session.add(receipt)

    receipt.read_at = receipt.read_at or moment
    if acknowledge:
        receipt.acknowledged_at = receipt.acknowledged_at or moment
    session.flush()

    return _notice(row, receipt, moment=moment)
