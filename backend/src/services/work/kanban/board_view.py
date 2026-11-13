"""One board whole: its lanes and their cards, filtered."""

from __future__ import annotations

from typing import Any

from sqlalchemy import Select, func, or_, select

from src.core.pagination import parse_uuid
from src.services.work.kanban.access import _board_row
from src.services.work.kanban.fields import _kind
from src.services.work.kanban.serializers import _board, _card, comment_counts
from src.services.work.kanban.vocabulary import (
    CARDS_PER_LANE,
    KINDS,
    PARENT_OF,
    PRIORITIES,
    VIEW_PERMISSION,
)


def board(session, board_id: Any, args, *, principal) -> dict[str, Any]:
    """One board: its lanes, the cards in each, and what may be filtered.

    The filters are applied in SQL and the *counts* are per lane over the
    whole match — so "In progress (12)" means twelve of the cards this reader
    asked about, not twelve of the ones that fitted on screen (§71).
    """
    principal.require(VIEW_PERMISSION)
    from src.models.kanban import BoardCard

    row = _board_row(session, board_id, principal)
    assignee = (args.get("assignee_id") or "").strip()
    label = (args.get("label") or "").strip()
    kind = _kind(args.get("kind")) if args.get("kind") else ""
    term = (args.get("q") or "").strip()

    def scoped() -> Select:
        statement = select(BoardCard).where(
            BoardCard.board_id == row.id, BoardCard.deleted_at.is_(None)
        )
        if assignee:
            statement = statement.where(
                BoardCard.assignee_id == parse_uuid(assignee, field="assignee_id")
            )
        if label:
            statement = statement.where(BoardCard.labels.any(label))
        if kind:
            statement = statement.where(BoardCard.kind == kind)
        if term:
            like = f"%{term}%"
            statement = statement.where(
                or_(
                    BoardCard.title.ilike(like),
                    BoardCard.reference.ilike(like),
                    BoardCard.description.ilike(like),
                )
            )
        return statement

    matched = scoped()
    counts = dict(
        session.execute(
            matched.with_only_columns(BoardCard.lane_id, func.count()).group_by(BoardCard.lane_id)
        ).all()
    )
    cards = session.scalars(
        matched.order_by(BoardCard.position.asc(), BoardCard.created_at.asc())
    ).all()

    by_lane: dict[Any, list[Any]] = {}
    for item in cards:
        by_lane.setdefault(item.lane_id, []).append(item)

    # How many people have said something on each card, counted once for the
    # whole board. A card's face shows it (§18) — "two comments" is often the
    # reason to open a card rather than the next one — and asking per card
    # would be forty queries for a picture of one board.
    conversations = comment_counts(session, [item.id for item in cards])

    # Every label in use on this board, so the filter offers what is there
    # rather than a free-text box that matches nothing.
    labels = sorted(
        {
            value
            for item in session.scalars(
                select(BoardCard).where(
                    BoardCard.board_id == row.id, BoardCard.deleted_at.is_(None)
                )
            ).all()
            for value in (item.labels or [])
        }
    )

    return {
        "board": _board(row, principal, cards=len(cards)),
        "lanes": [
            {
                "id": str(lane.id),
                "name": lane.name,
                "position": lane.position,
                "wip_limit": lane.wip_limit,
                "is_done": bool(lane.is_done),
                # The whole match, not the slice returned — see the docstring.
                "total": int(counts.get(lane.id, 0)),
                # A limit warns; it never refuses. Published so the board can
                # say so without this service deciding what to do about it.
                "over_limit": bool(
                    lane.wip_limit is not None and int(counts.get(lane.id, 0)) > lane.wip_limit
                ),
                "cards": [
                _card(item, comments=conversations.get(item.id, 0))
                for item in by_lane.get(lane.id, [])[:CARDS_PER_LANE]
            ],
            }
            for lane in row.lanes
            if lane.deleted_at is None
        ],
        # A card whose lane was removed while somebody was looking at the page.
        # Shown rather than hidden: it is work, and work that is nowhere is
        # exactly what somebody needs to see.
        "unplaced": [
            _card(item, comments=conversations.get(item.id, 0))
            for item in by_lane.get(None, [])
        ],
        "labels": labels,
        "kinds": [{"key": name, "children": list(PARENT_OF[name])} for name in KINDS],
        "priorities": list(PRIORITIES),
        "filters": {"assignee_id": assignee, "label": label, "kind": kind, "q": term},
    }
