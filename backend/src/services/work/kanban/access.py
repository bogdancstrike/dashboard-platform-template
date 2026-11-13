"""Which boards a reader sees and may write, and the row lookups every write starts with."""

from __future__ import annotations

from typing import Any

from sqlalchemy import Select, select

from src.core import sharing
from src.core.errors import ConflictError, NotFoundError, ValidationError
from src.core.pagination import parse_uuid
from src.services.work.kanban.vocabulary import MANAGE_PERMISSION, RESOURCE


def _visible(principal) -> Any:
    from src.models.kanban import Board

    return sharing.visibility(Board, RESOURCE, principal)


def _board_statement(principal) -> Select:
    from src.models.kanban import Board

    return select(Board).where(Board.deleted_at.is_(None), _visible(principal))


def _lane_for(board_row, raw: Any):
    """The lane named, or the leftmost one — never nothing."""
    live = [lane for lane in board_row.lanes if lane.deleted_at is None]
    if not live:
        raise ConflictError("That board has no lanes.", details={"board": str(board_row.id)})
    if raw in (None, ""):
        return min(live, key=lambda lane: lane.position)
    wanted = str(raw)
    lane = next((item for item in live if str(item.id) == wanted), None)
    if lane is None:
        raise ValidationError("That lane is not on this board.", details={"lane_id": wanted})
    return lane


def _writable(board_row, principal) -> bool:
    return bool(board_row.owner_id == principal.user_id and principal.can(MANAGE_PERMISSION))


def _require_writable(board_row, principal) -> None:
    principal.require(MANAGE_PERMISSION)
    sharing.require_owner(board_row, principal, kind="board")


def _board_row(session, board_id: Any, principal):
    from src.models.kanban import Board

    wanted = parse_uuid(board_id, field="board_id")
    row = session.scalars(
        select(Board).where(
            Board.id == wanted, Board.deleted_at.is_(None), _visible(principal)
        )
    ).one_or_none()
    if row is None:
        raise NotFoundError("That board does not exist.", details={"id": str(wanted)})
    return row


def _lane_row(session, lane_id: Any, principal):
    from src.models.kanban import BoardLane

    wanted = parse_uuid(lane_id, field="lane_id")
    row = session.scalars(
        select(BoardLane).where(BoardLane.id == wanted, BoardLane.deleted_at.is_(None))
    ).one_or_none()
    if row is None:
        raise NotFoundError("That lane does not exist.", details={"id": str(wanted)})
    _board_row(session, row.board_id, principal)
    return row


def _card_row(session, card_id: Any, principal):
    from src.models.kanban import BoardCard

    wanted = parse_uuid(card_id, field="card_id")
    row = session.scalars(
        select(BoardCard).where(BoardCard.id == wanted, BoardCard.deleted_at.is_(None))
    ).one_or_none()
    if row is None:
        raise NotFoundError("That card does not exist.", details={"id": str(wanted)})
    # Reading a card is reading its board: one visibility rule, not two.
    _board_row(session, row.board_id, principal)
    return row
