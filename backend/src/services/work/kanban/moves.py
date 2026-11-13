"""Dropping a card: renumbering its neighbours, possibly in another lane."""

from __future__ import annotations

from typing import Any

from sqlalchemy import select

from src.core.clock import now
from src.core.errors import ValidationError
from src.services.work.kanban.access import (
    _board_row,
    _card_row,
    _lane_for,
    _require_writable,
)
from src.services.work.kanban.serializers import _card


def move_card(session, card_id: Any, payload: Any, *, principal) -> dict[str, Any]:
    """Put a card in a lane at a position, and renumber what it displaced.

    Dense integers, rewritten within the two lanes involved. A float midpoint
    would avoid the rewrite and drift into precision nobody can debug; this
    touches a handful of rows and can never leave two cards claiming one place.
    """
    from src.core import audit
    from src.models.kanban import BoardCard

    row = _card_row(session, card_id, principal)
    board_row = _board_row(session, row.board_id, principal)
    _require_writable(board_row, principal)
    body = payload if isinstance(payload, dict) else {}

    lane = _lane_for(board_row, body.get("lane_id") or row.lane_id)
    try:
        index = max(0, int(body.get("position", 0)))
    except (TypeError, ValueError) as exc:
        raise ValidationError("position must be an integer.") from exc

    was = {"lane_id": row.lane_id, "position": row.position}
    siblings = list(
        session.scalars(
            select(BoardCard)
            .where(
                BoardCard.lane_id == lane.id,
                BoardCard.deleted_at.is_(None),
                BoardCard.id != row.id,
            )
            .order_by(BoardCard.position.asc(), BoardCard.created_at.asc())
        ).all()
    )
    siblings.insert(min(index, len(siblings)), row)

    row.lane_id = lane.id
    for position, item in enumerate(siblings):
        item.position = position

    # Arriving in the "done" lane is a completion, and leaving it undoes one:
    # a board whose `completed_at` disagreed with its columns would report a
    # different number from the one on screen.
    if lane.is_done and row.completed_at is None:
        row.completed_at = now()
    elif not lane.is_done and row.completed_at is not None:
        row.completed_at = None
    if not lane.is_done and row.started_at is None and lane.position > 0:
        row.started_at = now()

    # Renumber the lane it left, so a gap does not become a permanent one.
    if was["lane_id"] and was["lane_id"] != lane.id:
        _renumber(session, was["lane_id"])

    session.flush()
    audit.record(
        session,
        action="STATUS_CHANGE",
        resource_type="kanban_card",
        resource_id=row.id,
        resource_label=f"{row.reference} {row.title}",
        principal=principal,
        before={"lane": str(was["lane_id"]), "position": was["position"]},
        after={"lane": str(lane.id), "position": row.position},
        message=f"moved {row.reference} to {lane.name}",
    )
    return _card(row)


def _renumber(session, lane_id) -> None:
    """Make a lane's positions dense again after something left it."""
    from src.models.kanban import BoardCard

    rows = session.scalars(
        select(BoardCard)
        .where(BoardCard.lane_id == lane_id, BoardCard.deleted_at.is_(None))
        .order_by(BoardCard.position.asc(), BoardCard.created_at.asc())
    ).all()
    for position, row in enumerate(rows):
        row.position = position
