"""Sprint states, points, scope and stats; a sprint and a card as the API returns them."""

from __future__ import annotations

from typing import Any

from sqlalchemy import select

from src.core.clock import now
from src.core.errors import NotFoundError
from src.core.pagination import parse_uuid
from src.services.work.timeline import _person

READ = "tasks.view"


MANAGE = "tasks.manage"


STATES = ("PLANNED", "ACTIVE", "COMPLETED")


CLOSED = ("DONE", "CANCELLED")


DEFAULT_LENGTH_DAYS = 14


STEP = 1024.0


_MIN_GAP = 1e-6


BACKLOG_LIMIT = 300


def _points(value: Any) -> float:
    return float(value) if value is not None else 0.0


def _sprint(session, sprint_id: Any):
    from src.models.planning import Sprint

    identifier = parse_uuid(sprint_id, field="sprint_id")
    row = session.scalars(
        select(Sprint).where(Sprint.id == identifier, Sprint.deleted_at.is_(None))
    ).first()
    if row is None:
        raise NotFoundError("No sprint with that id.", details={"sprint_id": str(sprint_id)})
    return row


def _scope(session, sprint_id) -> list:
    from src.models.business import Task

    return session.scalars(
        select(Task)
        .where(Task.sprint_id == sprint_id, Task.deleted_at.is_(None))
        .order_by(Task.board_position.asc(), Task.reference.asc())
    ).unique().all()


def stats(tasks: list) -> dict[str, Any]:
    """Points and counts over a sprint's scope; cancelled work counts for nothing."""
    live = [task for task in tasks if task.status != "CANCELLED"]
    done = [task for task in live if task.status == "DONE"]
    total = sum(_points(task.story_points) for task in live)
    finished = sum(_points(task.story_points) for task in done)
    return {
        "total_points": total,
        "done_points": finished,
        "remaining_points": total - finished,
        "total_tasks": len(live),
        "done_tasks": len(done),
    }


def summary(session, row, tasks: list | None = None) -> dict[str, Any]:
    from src.models.business import Project

    tasks = _scope(session, row.id) if tasks is None else tasks
    project = session.get(Project, row.project_id) if row.project_id else None
    today = now().date()
    days_left = None
    if row.state == "ACTIVE" and row.end_date:
        days_left = max(0, (row.end_date - today).days)
    return {
        "id": str(row.id),
        "name": row.name,
        "goal": row.goal,
        "state": row.state,
        "project": {"id": str(project.id), "name": project.name, "code": project.code, "color": project.color} if project else None,
        "start_date": row.start_date.isoformat() if row.start_date else None,
        "end_date": row.end_date.isoformat() if row.end_date else None,
        "capacity_points": _points(row.capacity_points) if row.capacity_points is not None else None,
        "committed_points": _points(row.committed_points) if row.committed_points is not None else None,
        "completed_points": _points(row.completed_points) if row.completed_points is not None else None,
        "started_at": row.started_at.isoformat() if row.started_at else None,
        "completed_at": row.completed_at.isoformat() if row.completed_at else None,
        "days_left": days_left,
        **stats(tasks),
    }


def card(task) -> dict[str, Any]:
    checklist = task.checklist or []
    return {
        "id": str(task.id),
        "reference": task.reference,
        "title": task.title,
        "status": task.status,
        "priority": task.priority,
        "kind": task.kind,
        "story_points": _points(task.story_points) if task.story_points is not None else None,
        "assignee": _person(task.assignee),
        "epic_id": str(task.epic_id) if task.epic_id else None,
        "project_id": str(task.project_id) if task.project_id else None,
        "sprint_id": str(task.sprint_id) if task.sprint_id else None,
        "due_date": task.due_date.isoformat() if task.due_date else None,
        "blocked_reason": task.blocked_reason,
        "cover_color": task.cover_color,
        "tags": list(task.tags or []),
        "checklist_total": len(checklist),
        "checklist_done": sum(1 for item in checklist if isinstance(item, dict) and item.get("done")),
        "backlog_rank": float(task.backlog_rank or 0),
        "board_position": float(task.board_position or 0),
        "updated_at": task.updated_at.isoformat() if task.updated_at else None,
    }
