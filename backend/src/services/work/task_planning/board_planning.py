"""A board's planning view: brief cards, the plan, watching, lanes."""

from __future__ import annotations

from typing import Any

from sqlalchemy import func, select

from src.core import vocabulary
from src.core.clock import now
from src.core.errors import NotFoundError
from src.core.pagination import parse_uuid
from src.services.records import writes as record_writes
from src.services.work.sprints import MANAGE, READ, _points
from src.services.work.timeline import _person, _task, span_of


def _brief(task) -> dict[str, Any]:
    first, last, planned = span_of(task)
    return {
        "id": str(task.id),
        "reference": task.reference,
        "title": task.title,
        "status": task.status,
        "kind": task.kind,
        "story_points": _points(task.story_points) if task.story_points is not None else None,
        "assignee": _person(task.assignee),
        "start": first.isoformat() if planned else None,
        "end": last.isoformat() if planned else None,
    }


def planning(session, task_id: Any, *, principal) -> dict[str, Any]:
    from src.models.business import Task
    from src.models.identity import User
    from src.models.planning import Sprint, TaskDependency, TaskRecurrence, TaskWatcher

    principal.require(READ)
    task = _task(session, task_id)

    epic = _task(session, task.epic_id) if task.epic_id else None
    parent = _task(session, task.parent_id) if task.parent_id else None
    sprint = session.get(Sprint, task.sprint_id) if task.sprint_id else None
    alive = Task.deleted_at.is_(None)
    subtasks = session.scalars(
        select(Task).where(Task.parent_id == task.id, alive).order_by(Task.reference)
    ).unique().all()
    children = session.scalars(
        select(Task).where(Task.epic_id == task.id, alive).order_by(Task.reference)
    ).unique().all() if task.kind == "EPIC" else []

    def linked(column_from, column_to):
        rows = session.execute(
            select(TaskDependency, Task)
            .join(Task, Task.id == column_to)
            .where(column_from == task.id, alive)
        ).unique().all()
        return [
            {"dependency_id": str(link.id), "lag_days": link.lag_days, **_brief(other)}
            for link, other in rows
        ]

    watchers = session.execute(
        select(User).join(TaskWatcher, TaskWatcher.user_id == User.id).where(TaskWatcher.task_id == task.id)
    ).scalars().unique().all()
    recurrence = session.scalars(
        select(TaskRecurrence).where(TaskRecurrence.task_id == task.id)
    ).first()

    from src.services.work.task_templates import describe_rule

    return {
        "id": str(task.id),
        "epic": _brief(epic) if epic else None,
        "parent": _brief(parent) if parent else None,
        "sprint": {
            "id": str(sprint.id), "name": sprint.name, "state": sprint.state,
            "end_date": sprint.end_date.isoformat() if sprint.end_date else None,
        } if sprint else None,
        "subtasks": [_brief(item) for item in subtasks],
        "children": [_brief(item) for item in children],
        "children_done": sum(1 for item in children if item.status == "DONE"),
        "blocked_by": linked(TaskDependency.successor_id, TaskDependency.predecessor_id),
        "blocking": linked(TaskDependency.predecessor_id, TaskDependency.successor_id),
        "watchers": [_person(user) for user in watchers],
        "watching": any(user.id == principal.user_id for user in watchers),
        "recurrence": describe_rule(recurrence) if recurrence else None,
        "status_changed_at": task.status_changed_at.isoformat() if task.status_changed_at else None,
        "can_edit": principal.can(record_writes.UPDATE_PERMISSION),
        "can_manage": principal.can(MANAGE),
    }


def watch(session, task_id: Any, payload: Any, *, principal, on: bool) -> dict[str, Any]:
    """Watch (or stop watching) a task — yourself, or somebody else if you may edit it."""
    from src.models.identity import User
    from src.models.planning import TaskWatcher

    principal.require(READ)
    task = _task(session, task_id)
    body = payload if isinstance(payload, dict) else {}
    user_id = parse_uuid(body["user_id"], field="user_id") if body.get("user_id") else principal.user_id
    if user_id != principal.user_id:
        principal.require(record_writes.UPDATE_PERMISSION)
        if session.get(User, user_id) is None:
            raise NotFoundError("No person with that id.", details={"user_id": str(user_id)})
    existing = session.get(TaskWatcher, (task.id, user_id))
    if on and existing is None:
        session.add(TaskWatcher(task_id=task.id, user_id=user_id, created_at=now()))
    elif not on and existing is not None:
        session.delete(existing)
    session.flush()
    count = session.scalar(
        select(func.count()).select_from(TaskWatcher).where(TaskWatcher.task_id == task.id)
    ) or 0
    return {"id": str(task.id), "user_id": str(user_id), "watching": on, "watchers": count}


def lanes(session, *, principal) -> dict[str, Any]:
    from src.models.business import Task
    from src.models.planning import TaskLaneSetting

    principal.require(READ)
    limits = {row.status: row.wip_limit for row in session.scalars(select(TaskLaneSetting)).all()}
    counts = dict(
        session.execute(
            select(Task.status, func.count()).where(Task.deleted_at.is_(None)).group_by(Task.status)
        ).all()
    )
    return {
        "items": [
            {
                "status": status,
                "wip_limit": limits.get(status),
                "count": int(counts.get(status, 0)),
                "over_limit": limits.get(status) is not None and counts.get(status, 0) > limits[status],
            }
            for status in vocabulary.TASK_STATUS
        ],
        "can_manage": principal.can(MANAGE),
    }
