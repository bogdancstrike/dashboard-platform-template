"""Where a task sits on the task board (§18).

The board at `/tasks` is arranged by hand: a card dropped between two others
stays there after a reload. The order is `tasks.board_position`, a *sparse,
fractional* rank — a drop takes the midpoint of its two new neighbours, so a
move writes exactly one row. Only when two neighbours have been split so often
that no number fits between them is the lane renumbered, once, with wide gaps
again.

The client names neighbours rather than a number. A browser that computed the
rank would be computing it from the twelve cards it happens to have loaded,
with values another tab may already have changed; the server reads the
neighbours' ranks as they are now, inside the same transaction as the write.

A move that also changes the lane is a status change, and is written through
`record_writes.apply_values`, so the ledger records it exactly as an edit of
the status field would be recorded — one decision about what a move *is*.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import select

from src.core.errors import ValidationError
from src.core.pagination import parse_uuid
from src.services import record_writes
from src.services.explorer import resource_for

#: The gap left between neighbours when a lane is (re)numbered.
STEP = 1024.0
#: Below this, a midpoint is no longer reliably distinct from its neighbours.
_MIN_GAP = 1e-6


def place(session, task_id: Any, payload: Any, *, principal) -> dict[str, Any]:
    """Put a task in a lane, between two neighbours.

    Payload: ``status`` (the lane; defaults to the task's own), ``after_id``
    (the card that will be directly above it, or null for the top) and
    ``before_id`` (directly below, or null for the bottom), plus the optional
    ``expected_updated_at`` every record write accepts (§73).
    """
    from src.models.business import Task

    resource = resource_for("task", principal=principal)
    principal.require(record_writes.UPDATE_PERMISSION)
    body = payload if isinstance(payload, dict) else {}

    row = record_writes._load(session, resource, task_id)
    record_writes._refuse_a_lost_race(resource, row, body.get(record_writes.CONCURRENCY_KEY))

    status = body.get("status") or row.status
    if status != row.status:
        values = record_writes._coerced(session, resource, {"status": status}, creating=False)
        record_writes.apply_values(session, resource, row, values, principal=principal)

    after = _neighbour(session, Task, body.get("after_id"), row, "after_id")
    before = _neighbour(session, Task, body.get("before_id"), row, "before_id")
    rank = _between(*_adjacent(session, Task, row, after, before))
    if rank is None:
        _renumber(session, Task, row.status)
        rank = _between(*_adjacent(session, Task, row, after, before))
    if rank is None:  # pragma: no cover - renumbering always opens a gap
        raise ValidationError("That position could not be found.")

    row.board_position = rank
    session.flush()
    return {
        "id": str(row.id),
        "status": row.status,
        "board_position": row.board_position,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


def _neighbour(session, model, raw: Any, row, field: str):
    """A neighbour named by the client — only if it is in the same lane."""
    if not raw:
        return None
    identifier = parse_uuid(raw, field=field)
    if identifier == row.id:
        raise ValidationError("A card cannot be placed next to itself.", details={field: str(raw)})
    neighbour = session.scalars(
        select(model).where(model.id == identifier, model.deleted_at.is_(None))
    ).first()
    # A neighbour that has since left the lane says nothing about where this
    # card goes in it; ignoring it lands the card at that end instead.
    if neighbour is None or neighbour.status != row.status:
        return None
    return neighbour


def _adjacent(session, model, row, after, before):
    """Fill in the side the client could not see.

    A lane on screen is its first dozen cards, and filters hide others, so
    "after X, with nothing below" means *directly* after X — before whatever
    card really follows it — not after every card in the lane. The same for
    "before Y" and for a lane that only looked empty.
    """
    lane = (
        select(model)
        .where(model.status == row.status, model.deleted_at.is_(None), model.id != row.id)
    )
    if after is not None and before is None:
        before = session.scalars(
            lane.where(model.board_position > after.board_position)
            .order_by(model.board_position.asc(), model.id.asc())
        ).first()
    elif before is not None and after is None:
        after = session.scalars(
            lane.where(model.board_position < before.board_position)
            .order_by(model.board_position.desc(), model.id.desc())
        ).first()
    elif after is None and before is None:
        before = session.scalars(
            lane.order_by(model.board_position.asc(), model.id.asc())
        ).first()
    return after, before


def _between(after, before) -> float | None:
    low = float(after.board_position) if after is not None else None
    high = float(before.board_position) if before is not None else None
    if low is None and high is None:
        return STEP
    if high is None:
        return low + STEP
    if low is None:
        return high - STEP
    if high - low <= _MIN_GAP:
        return None
    return low + (high - low) / 2


def _renumber(session, model, status: str) -> None:
    """Open wide gaps in a lane again, keeping its order."""
    rows = session.scalars(
        select(model)
        .where(model.status == status, model.deleted_at.is_(None))
        .order_by(model.board_position.asc(), model.id.asc())
    ).all()
    for index, item in enumerate(rows, start=1):
        item.board_position = index * STEP
    session.flush()
