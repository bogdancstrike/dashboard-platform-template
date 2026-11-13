"""The board list and one card with its family."""

from __future__ import annotations

from typing import Any

from sqlalchemy import func, select

from src.services.work.kanban.access import (
    _board_row,
    _board_statement,
    _card_row,
    _writable,
)
from src.services.work.kanban.serializers import _board, _card
from src.services.work.kanban.vocabulary import (
    KINDS,
    MANAGE_PERMISSION,
    PARENT_OF,
    PRIORITIES,
    VIEW_PERMISSION,
)


def boards(session, args, *, principal) -> dict[str, Any]:
    """Every board this reader may open, newest first.

    Archived ones only when asked for: a board somebody finished with is not
    deleted — the cards on it are a record — but it is not what they came for
    either.
    """
    principal.require(VIEW_PERMISSION)
    from src.models.kanban import Board, BoardCard

    include_archived = str(args.get("archived") or "").lower() in ("1", "true", "yes")
    statement = _board_statement(principal)
    if not include_archived:
        statement = statement.where(Board.is_archived.is_(False))

    rows = session.scalars(statement.order_by(Board.created_at.desc())).all()
    counts = dict(
        session.execute(
            select(BoardCard.board_id, func.count())
            .where(
                BoardCard.deleted_at.is_(None),
                BoardCard.board_id.in_([row.id for row in rows] or [None]),
            )
            .group_by(BoardCard.board_id)
        ).all()
    )

    return {
        "items": [_board(row, principal, cards=int(counts.get(row.id, 0))) for row in rows],
        "total": len(rows),
        "can_create": principal.can(MANAGE_PERMISSION),
        "kinds": [{"key": kind, "children": list(PARENT_OF[kind])} for kind in KINDS],
        "priorities": list(PRIORITIES),
    }


def card(session, card_id: Any, *, principal) -> dict[str, Any]:
    """One card, with the board it is on and the family around it."""
    principal.require(VIEW_PERMISSION)
    from src.models.kanban import BoardCard

    row = _card_row(session, card_id, principal)
    parent = session.get(BoardCard, row.parent_id) if row.parent_id else None
    children = session.scalars(
        select(BoardCard)
        .where(BoardCard.parent_id == row.id, BoardCard.deleted_at.is_(None))
        .order_by(BoardCard.position.asc())
    ).all()
    board_row = _board_row(session, row.board_id, principal)

    return {
        **_card(row),
        "board": _board(board_row, principal),
        "lanes": [
            {"id": str(lane.id), "name": lane.name, "is_done": bool(lane.is_done)}
            for lane in board_row.lanes
            if lane.deleted_at is None
        ],
        "parent": _card(parent) if parent and parent.deleted_at is None else None,
        "children": [_card(child) for child in children],
        # What this card *may* be given as a parent, from the one rule.
        "parent_options": [_card(option) for option in _possible_parents(session, row)],
        "can_edit": _writable(board_row, principal),
    }


def _possible_parents(session, row) -> list[Any]:
    from src.models.kanban import BoardCard

    wanted = [kind for kind, children in PARENT_OF.items() if row.kind in children]
    if not wanted:
        return []
    return list(
        session.scalars(
            select(BoardCard)
            .where(
                BoardCard.board_id == row.board_id,
                BoardCard.deleted_at.is_(None),
                BoardCard.kind.in_(wanted),
                BoardCard.id != row.id,
            )
            .order_by(BoardCard.reference.asc())
        ).all()
    )
