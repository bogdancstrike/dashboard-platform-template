"""What a task page shows beside the record: its place in the plan (§18).

The record itself — title, status, dates, points, epic, checklist — is read and
written through the generic records API like every dataset. This answers the
questions a single row cannot: which epic and sprint it is in, what it waits
on and what waits on it, its subtasks, who watches it, whether it recurs.

Also here, because they are the task board's settings rather than anybody's
record: the work-in-progress limit on each lane, and the epics a board can be
filtered and swimlaned by.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import func, select

from src.core import audit, vocabulary
from src.core.clock import now
from src.core.errors import NotFoundError, ValidationError
from src.core.pagination import parse_uuid
from src.services import record_writes
from src.services.sprints import MANAGE, READ, _points, card
from src.services.timeline import _person, _task, span_of


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

    from src.services.task_templates import describe_rule

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


def set_lanes(session, payload: Any, *, principal) -> dict[str, Any]:
    """`{"IN_PROGRESS": 8, "IN_REVIEW": null}` — a limit per lane; null is none."""
    from src.models.planning import TaskLaneSetting

    principal.require(MANAGE)
    body = payload if isinstance(payload, dict) else {}
    limits = body.get("limits", body)
    if not isinstance(limits, dict) or not limits:
        raise ValidationError("Name at least one lane and its limit.", details={})
    for status, raw in limits.items():
        if status not in vocabulary.TASK_STATUS:
            raise ValidationError(f"{status} is not a lane on the task board.", details={"status": status})
        value = None
        if raw not in (None, ""):
            try:
                value = int(raw)
            except (TypeError, ValueError) as exc:
                raise ValidationError("A limit is a whole number.", details={"status": status, "value": raw}) from exc
            if value < 1 or value > 999:
                raise ValidationError("A limit is between 1 and 999 — clear it for none.", details={"status": status})
        row = session.get(TaskLaneSetting, status)
        if row is None:
            row = TaskLaneSetting(status=status)
            session.add(row)
        row.wip_limit = value
        row.updated_at = now()
    session.flush()
    audit.record(
        session, action="CONFIGURATION_CHANGE", resource_type="task_board",
        resource_label="Task board", principal=principal, after={"wip_limits": limits},
        message="changed the task board's lane limits", activity=False,
    )
    return lanes(session, principal=principal)


def epics(session, args: dict[str, Any], *, principal) -> dict[str, Any]:
    """Every epic, with how far along its work is."""
    from src.models.business import Task

    principal.require(READ)
    statement = select(Task).where(Task.deleted_at.is_(None), Task.kind == "EPIC")
    if args.get("project_id"):
        statement = statement.where(Task.project_id == parse_uuid(args["project_id"], field="project_id"))
    rows = session.scalars(statement.order_by(Task.title)).unique().all()
    ids = [row.id for row in rows]
    totals: dict[Any, tuple[int, int, float]] = {}
    if ids:
        for epic_id, total, done, points in session.execute(
            select(
                Task.epic_id,
                func.count(),
                func.count().filter(Task.status == "DONE"),
                func.coalesce(func.sum(Task.story_points), 0),
            )
            .where(Task.epic_id.in_(ids), Task.deleted_at.is_(None))
            .group_by(Task.epic_id)
        ).all():
            totals[epic_id] = (int(total), int(done), float(points))
    return {
        "items": [
            {
                **card(row),
                "children": totals.get(row.id, (0, 0, 0.0))[0],
                "children_done": totals.get(row.id, (0, 0, 0.0))[1],
                "points": totals.get(row.id, (0, 0, 0.0))[2],
            }
            for row in rows
        ]
    }
