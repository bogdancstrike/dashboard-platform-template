"""Completing a sprint, and snapshotting progress."""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy import select

from src.core.clock import now
from src.core.errors import ConflictError, ValidationError
from src.services.work.sprints.metrics import (
    CLOSED,
    DEFAULT_LENGTH_DAYS,
    MANAGE,
    _points,
    _scope,
    _sprint,
    stats,
    summary,
)
from src.services.work.sprints.writing import _audit, _body, snapshot


def complete(session, sprint_id: Any, payload: Any, *, principal) -> dict[str, Any]:
    """Close the box; carry unfinished work to the backlog, the next sprint or a new one."""
    from src.models.planning import Sprint

    principal.require(MANAGE)
    row = _sprint(session, sprint_id)
    if row.state != "ACTIVE":
        raise ConflictError(f"{row.name} is not running.", details={"state": row.state})
    body = _body(payload)
    target_raw = body.get("carry_over") or "backlog"
    tasks = _scope(session, row.id)
    numbers = stats(tasks)
    today = now().date()
    snapshot(session, row, today)

    target = None
    if target_raw == "new":
        target = Sprint(
            project_id=row.project_id,
            name=_next_name(row.name),
            state="PLANNED",
            start_date=today + timedelta(days=1),
            end_date=today + timedelta(days=DEFAULT_LENGTH_DAYS),
            capacity_points=row.capacity_points,
            created_by_id=principal.user_id,
        )
        session.add(target)
        session.flush()
    elif target_raw == "next":
        target = session.scalars(
            select(Sprint).where(
                Sprint.deleted_at.is_(None), Sprint.state == "PLANNED", Sprint.id != row.id,
                Sprint.project_id == row.project_id if row.project_id else Sprint.project_id.is_(None),
            ).order_by(Sprint.start_date.asc().nulls_last(), Sprint.created_at.asc())
        ).first()
        if target is None:
            raise ValidationError(
                "There is no planned sprint to carry the work into — choose the backlog or a new sprint.",
                details={"carry_over": "next"},
            )
    elif target_raw != "backlog":
        target = _sprint(session, target_raw)
        if target.state != "PLANNED" or target.id == row.id:
            raise ValidationError("Work can only be carried into a planned sprint.", details={"carry_over": str(target_raw)})

    stamp = now()
    carried, finished = [], []
    for task in tasks:
        if task.status in CLOSED:
            if task.status == "DONE":
                finished.append(task.reference)
            continue
        carried.append(task.reference)
        task.sprint_id = target.id if target else None
        task.sprint_added_at = stamp if target else None

    added_late = [
        task.reference for task in tasks
        if task.sprint_added_at and row.started_at and task.sprint_added_at > row.started_at
        and task.reference not in carried
    ]
    row.state = "COMPLETED"
    row.completed_at = stamp
    row.completed_points = Decimal(str(numbers["done_points"]))
    row.report = {
        "committed_points": _points(row.committed_points),
        "completed_points": numbers["done_points"],
        "completed": finished,
        "carried_over": carried,
        "carried_to": {"id": str(target.id), "name": target.name} if target else "backlog",
        "added_after_start": added_late,
        "total_tasks": numbers["total_tasks"],
        "done_tasks": numbers["done_tasks"],
    }
    session.flush()
    _audit(session, row, "UPDATE", principal, f"completed {row.name}")
    return summary(session, row) | {"report": row.report}


def _next_name(name: str) -> str:
    head, _, tail = name.rpartition(" ")
    if tail.isdigit():
        return f"{head} {int(tail) + 1}"
    return f"{name} (continued)"


def snapshot_active(session, day: date | None = None) -> int:
    """Today's snapshot for every running sprint — the scheduler's job."""
    from src.models.planning import Sprint

    day = day or now().date()
    rows = session.scalars(
        select(Sprint).where(Sprint.deleted_at.is_(None), Sprint.state == "ACTIVE")
    ).all()
    for row in rows:
        snapshot(session, row, day)
    return len(rows)
