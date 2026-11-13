"""Lanes: create, change, remove (moving their cards), and reorder."""

from __future__ import annotations

from typing import Any

from sqlalchemy import select

from src.core.clock import now
from src.core.errors import ConflictError, ValidationError
from src.services.work.kanban.access import _board_row, _lane_row, _require_writable
from src.services.work.kanban.fields import _next_position
from src.services.work.kanban.serializers import _lane
from src.services.work.kanban.vocabulary import MAX_LANES


def create_lane(session, board_id: Any, payload: Any, *, principal) -> dict[str, Any]:
    """A column somebody named. The thing `/tasks` deliberately cannot do."""
    from src.models.kanban import BoardLane

    row = _board_row(session, board_id, principal)
    _require_writable(row, principal)
    body = payload if isinstance(payload, dict) else {}

    live = [lane for lane in row.lanes if lane.deleted_at is None]
    if len(live) >= MAX_LANES:
        raise ConflictError(
            f"A board holds at most {MAX_LANES} lanes.", details={"lanes": len(live)}
        )

    name = str(body.get("name") or "").strip()
    if not name:
        raise ValidationError("A lane needs a name.")

    is_done = bool(body.get("is_done"))
    if is_done:
        _clear_done(live)

    lane = BoardLane(
        board_id=row.id,
        name=name[:80],
        position=max((item.position for item in live), default=-1) + 1,
        wip_limit=_wip_limit(body.get("wip_limit")),
        is_done=is_done,
    )
    session.add(lane)
    session.flush()
    return _lane(lane)


def update_lane(session, lane_id: Any, payload: Any, *, principal) -> dict[str, Any]:
    row = _lane_row(session, lane_id, principal)
    board_row = _board_row(session, row.board_id, principal)
    _require_writable(board_row, principal)
    body = payload if isinstance(payload, dict) else {}

    if "name" in body:
        name = str(body.get("name") or "").strip()
        if not name:
            raise ValidationError("A lane needs a name.")
        row.name = name[:80]
    if "wip_limit" in body:
        row.wip_limit = _wip_limit(body.get("wip_limit"))
    if "is_done" in body:
        wanted = bool(body.get("is_done"))
        if wanted:
            # One "done" per board: two of them is two answers to "how much
            # have we shipped".
            _clear_done([lane for lane in board_row.lanes if lane.deleted_at is None])
        row.is_done = wanted
    session.flush()
    return _lane(row)


def remove_lane(session, lane_id: Any, args: Any, *, principal) -> dict[str, Any]:
    """Delete a lane, having moved its cards somewhere they can be found.

    Never a cascade. Losing somebody's work to a column they were tidying up
    is the single worst thing a board can do, so the destination is either
    named by the caller or is the lane to the left.

    Taken from the query string rather than a body: a `DELETE` with a body is
    carried unevenly by proxies and by every HTTP client in the stack — and
    `?move_to=` is a destination somebody can read in a log line.
    """
    from src.models.kanban import BoardCard

    row = _lane_row(session, lane_id, principal)
    board_row = _board_row(session, row.board_id, principal)
    _require_writable(board_row, principal)

    live = [lane for lane in board_row.lanes if lane.deleted_at is None and lane.id != row.id]
    if not live:
        raise ConflictError(
            "A board keeps at least one lane; its cards would have nowhere to go.",
            details={"lane": str(row.id)},
        )

    requested = str((args or {}).get("move_to") or "").strip()
    if requested:
        destination = next((lane for lane in live if str(lane.id) == requested), None)
        if destination is None:
            raise ValidationError(
                "That lane is not on this board.", details={"move_to": requested}
            )
    else:
        # The lane to the left, or the first one — wherever a reader would
        # look for the work next.
        earlier = [lane for lane in live if lane.position < row.position]
        destination = max(earlier, key=lambda lane: lane.position) if earlier else live[0]

    moved = session.scalars(
        select(BoardCard).where(BoardCard.lane_id == row.id, BoardCard.deleted_at.is_(None))
    ).all()
    tail = _next_position(session, destination.id)
    for offset, card_row in enumerate(moved):
        card_row.lane_id = destination.id
        card_row.position = tail + offset

    row.deleted_at = now()
    session.flush()
    return {
        "id": str(row.id),
        "deleted": True,
        "moved": len(moved),
        "moved_to": {"id": str(destination.id), "name": destination.name},
    }


def arrange_lanes(session, board_id: Any, payload: Any, *, principal) -> dict[str, Any]:
    """The whole column order at once, not one swap at a time.

    Sent whole because a drag produces one new order, and applying it as a
    series of swaps is a series of states a concurrent reader can observe —
    including ones where two lanes share a position.
    """
    row = _board_row(session, board_id, principal)
    _require_writable(row, principal)

    body = payload if isinstance(payload, dict) else {}
    order = body.get("lane_ids")
    if not isinstance(order, list) or not order:
        raise ValidationError("lane_ids must be the board's lanes in their new order.")

    live = {str(lane.id): lane for lane in row.lanes if lane.deleted_at is None}
    wanted = [str(item) for item in order]
    if set(wanted) != set(live):
        raise ValidationError(
            "lane_ids must name every lane on the board exactly once.",
            details={"expected": sorted(live), "received": wanted},
        )

    for position, lane_id in enumerate(wanted):
        live[lane_id].position = position
    session.flush()
    return {"lanes": [_lane(live[lane_id]) for lane_id in wanted]}


def _clear_done(lanes) -> None:
    for lane in lanes:
        lane.is_done = False


def _wip_limit(raw: Any) -> int | None:
    if raw in (None, ""):
        return None
    try:
        value = int(raw)
    except (TypeError, ValueError) as exc:
        raise ValidationError("wip_limit must be a whole number.") from exc
    if value < 1:
        # Zero would be a lane nothing may enter, which is not a limit.
        raise ValidationError("A work-in-progress limit is at least 1, or nothing at all.")
    return value
