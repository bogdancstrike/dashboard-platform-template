"""Rescheduling a bar, shifting what depends on it, and linking."""

from __future__ import annotations

from collections import deque
from datetime import timedelta
from typing import Any

from sqlalchemy import select

from src.core.errors import NotFoundError, ValidationError
from src.core.pagination import parse_uuid
from src.services.records import writes as record_writes
from src.services.records.explorer import resource_for
from src.services.work.timeline.spans import (
    CLOSED,
    as_day,
    at_midnight,
    span_of,
    violates,
)


def _task(session, task_id: Any, field: str = "task_id"):
    from src.models.business import Task

    identifier = parse_uuid(task_id, field=field)
    row = session.scalars(
        select(Task).where(Task.id == identifier, Task.deleted_at.is_(None))
    ).unique().first()
    if row is None:
        raise NotFoundError("No task with that id.", details={field: str(task_id)})
    return row


def schedule(session, task_id: Any, payload: Any, *, principal) -> dict[str, Any]:
    """Move or resize a bar; optionally push everything downstream along."""
    from src.models.planning import TaskDependency

    resource = resource_for("task", principal=principal)
    principal.require(record_writes.UPDATE_PERMISSION)
    body = payload if isinstance(payload, dict) else {}
    row = _task(session, task_id)
    record_writes._refuse_a_lost_race(resource, row, body.get(record_writes.CONCURRENCY_KEY))

    current_start, current_end, _planned = span_of(row)
    start = as_day(body.get("start_date")) or current_start
    end = as_day(body.get("due_date")) or current_end
    if end < start:
        raise ValidationError(
            "A task cannot be due before it starts.",
            details={"start_date": start.isoformat(), "due_date": end.isoformat()},
        )
    record_writes.apply_values(
        session, resource, row,
        {"start_date": at_midnight(start), "due_date": at_midnight(end)},
        principal=principal,
    )

    shifted: list[dict[str, Any]] = []
    if body.get("shift_dependants"):
        shifted = _shift_downstream(session, resource, row, principal=principal)

    incoming = session.scalars(select(TaskDependency).where(TaskDependency.successor_id == row.id)).all()
    outgoing = session.scalars(select(TaskDependency).where(TaskDependency.predecessor_id == row.id)).all()
    violations = []
    for link in incoming:
        pred = _task(session, link.predecessor_id)
        if violates(span_of(pred)[1], start, link.lag_days):
            violations.append(_violation(link, pred, row, "predecessor"))
    for link in outgoing:
        succ = _task(session, link.successor_id)
        if violates(end, span_of(succ)[0], link.lag_days):
            violations.append(_violation(link, row, succ, "successor"))

    session.flush()
    return {
        "id": str(row.id),
        "start_date": start.isoformat(),
        "due_date": end.isoformat(),
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
        "violations": violations,
        "shifted": shifted,
    }


def _violation(link, pred, succ, side: str) -> dict[str, Any]:
    pred_end = span_of(pred)[1]
    succ_start = span_of(succ)[0]
    return {
        "dependency_id": str(link.id),
        "side": side,
        "predecessor": {"id": str(pred.id), "reference": pred.reference, "title": pred.title, "end": pred_end.isoformat()},
        "successor": {"id": str(succ.id), "reference": succ.reference, "title": succ.title, "start": succ_start.isoformat()},
        "overlap_days": (pred_end + timedelta(days=link.lag_days) - succ_start).days + 1,
    }


def _shift_downstream(session, resource, row, *, principal) -> list[dict[str, Any]]:
    """Push every successor (transitively) just far enough, keeping its length."""
    from src.models.planning import TaskDependency

    moved: list[dict[str, Any]] = []
    queue = deque([row])
    seen = {row.id}
    guard = 0
    while queue and guard < 500:
        guard += 1
        current = queue.popleft()
        current_end = span_of(current)[1]
        for link in session.scalars(
            select(TaskDependency).where(TaskDependency.predecessor_id == current.id)
        ).all():
            succ = _task(session, link.successor_id)
            if succ.status in CLOSED:
                continue
            first, last, _planned = span_of(succ)
            earliest = current_end + timedelta(days=link.lag_days + 1)
            if first < earliest:
                delta = earliest - first
                record_writes.apply_values(
                    session, resource, succ,
                    {"start_date": at_midnight(first + delta), "due_date": at_midnight(last + delta)},
                    principal=principal,
                )
                moved.append({
                    "id": str(succ.id), "reference": succ.reference,
                    "start_date": (first + delta).isoformat(), "due_date": (last + delta).isoformat(),
                    "days": delta.days,
                })
            if succ.id not in seen or first < earliest:
                seen.add(succ.id)
                queue.append(succ)
    return moved


def _reaches(session, start, target) -> bool:
    """Whether `target` is downstream of `start`."""
    from src.models.planning import TaskDependency

    frontier = [start]
    seen = {start}
    while frontier:
        nexts = session.scalars(
            select(TaskDependency.successor_id).where(TaskDependency.predecessor_id.in_(frontier))
        ).all()
        frontier = []
        for item in nexts:
            if item == target:
                return True
            if item not in seen:
                seen.add(item)
                frontier.append(item)
    return False
