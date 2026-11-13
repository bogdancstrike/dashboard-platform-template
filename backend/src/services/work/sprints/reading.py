"""Sprints: list, detail, the backlog, burndown and velocity."""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from sqlalchemy import func, select

from src.core.clock import now
from src.core.errors import ValidationError
from src.core.pagination import parse_uuid
from src.services.work.sprints.metrics import (
    BACKLOG_LIMIT,
    CLOSED,
    MANAGE,
    READ,
    STATES,
    _points,
    _scope,
    _sprint,
    card,
    stats,
    summary,
)


def listing(session, args: dict[str, Any], *, principal) -> dict[str, Any]:
    from src.models.planning import Sprint

    principal.require(READ)
    statement = select(Sprint).where(Sprint.deleted_at.is_(None))
    project_id = args.get("project_id")
    if project_id:
        statement = statement.where(Sprint.project_id == parse_uuid(project_id, field="project_id"))
    state = (args.get("state") or "").upper()
    if state:
        if state not in STATES:
            raise ValidationError(f"A sprint is one of {', '.join(STATES)}.", details={"state": state})
        statement = statement.where(Sprint.state == state)
    rows = session.scalars(statement).all()
    order = {"ACTIVE": 0, "PLANNED": 1, "COMPLETED": 2}
    rows = sorted(
        rows,
        key=lambda row: (
            order.get(row.state, 3),
            # Completed sprints newest first; the others soonest first.
            -(row.end_date.toordinal() if row.end_date else 0) if row.state == "COMPLETED"
            else (row.start_date.toordinal() if row.start_date else 10**7),
            row.name,
        ),
    )
    return {
        "items": [summary(session, row) for row in rows],
        "can_manage": principal.can(MANAGE),
    }


def detail(session, sprint_id: Any, *, principal) -> dict[str, Any]:
    principal.require(READ)
    row = _sprint(session, sprint_id)
    tasks = _scope(session, row.id)
    return {
        **summary(session, row, tasks),
        "tasks": [card(task) for task in tasks],
        "burndown": burndown(session, row, tasks),
        "report": row.report,
        "can_manage": principal.can(MANAGE),
    }


def backlog(session, args: dict[str, Any], *, principal) -> dict[str, Any]:
    """Open work in no sprint, in the backlog's own order."""
    from src.models.business import Task

    principal.require(READ)
    statement = select(Task).where(
        Task.deleted_at.is_(None),
        Task.sprint_id.is_(None),
        Task.status.not_in(CLOSED),
        Task.kind != "EPIC",
    )
    project_id = args.get("project_id")
    if project_id:
        statement = statement.where(Task.project_id == parse_uuid(project_id, field="project_id"))
    term = (args.get("q") or "").strip()
    if term:
        like = f"%{term}%"
        statement = statement.where(Task.title.ilike(like) | Task.reference.ilike(like))
    total = session.scalar(select(func.count()).select_from(statement.subquery())) or 0
    rows = session.scalars(
        statement.order_by(Task.backlog_rank.asc(), Task.reference.asc()).limit(BACKLOG_LIMIT)
    ).unique().all()
    return {
        "items": [card(row) for row in rows],
        "total": total,
        "total_points": sum(_points(row.story_points) for row in rows),
        "can_manage": principal.can(MANAGE),
    }


def burndown(session, row, tasks: list | None = None) -> dict[str, Any]:
    """Ideal against actual, one point per day from the start to the end."""
    from src.models.planning import SprintSnapshot

    if not row.start_date or not row.end_date:
        return {"days": [], "ideal": [], "actual": [], "scope": []}
    tasks = _scope(session, row.id) if tasks is None else tasks
    snapshots = {
        item.day: item
        for item in session.scalars(
            select(SprintSnapshot).where(SprintSnapshot.sprint_id == row.id)
        ).all()
    }
    today = now().date()
    length = max(1, (row.end_date - row.start_date).days)
    committed = (
        _points(row.committed_points) if row.committed_points is not None
        else stats(tasks)["total_points"]
    )
    live = stats(tasks)
    days, ideal, actual, scope = [], [], [], []
    last: float | None = None
    last_scope: float | None = None
    for offset in range(length + 1):
        day = row.start_date + timedelta(days=offset)
        days.append(day.isoformat())
        ideal.append(round(committed * (1 - offset / length), 1))
        stop = row.completed_at.date() if row.completed_at else today
        if day > stop:
            actual.append(None)
            scope.append(None)
            continue
        if day == today and row.state == "ACTIVE":
            last, last_scope = live["remaining_points"], live["total_points"]
        elif day in snapshots:
            last = _points(snapshots[day].remaining_points)
            last_scope = _points(snapshots[day].total_points)
        actual.append(last)
        scope.append(last_scope)
    return {"days": days, "ideal": ideal, "actual": actual, "scope": scope, "committed": committed}


def velocity(session, args: dict[str, Any], *, principal) -> dict[str, Any]:
    """Committed against completed, for the last completed sprints."""
    from src.models.planning import Sprint

    principal.require(READ)
    statement = select(Sprint).where(Sprint.deleted_at.is_(None), Sprint.state == "COMPLETED")
    project_id = args.get("project_id")
    if project_id:
        statement = statement.where(Sprint.project_id == parse_uuid(project_id, field="project_id"))
    try:
        limit = max(1, min(24, int(args.get("limit") or 8)))
    except (TypeError, ValueError):
        limit = 8
    rows = session.scalars(statement.order_by(Sprint.end_date.desc().nulls_last()).limit(limit)).all()
    rows = list(reversed(rows))
    items = [
        {
            "id": str(row.id),
            "name": row.name,
            "end_date": row.end_date.isoformat() if row.end_date else None,
            "committed": _points(row.committed_points),
            "completed": _points(row.completed_points),
        }
        for row in rows
    ]
    completed = [item["completed"] for item in items]
    return {
        "items": items,
        "average": round(sum(completed) / len(completed), 1) if completed else 0.0,
    }
