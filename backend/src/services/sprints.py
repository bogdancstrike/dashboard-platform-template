"""Sprints: a backlog, time boxes drawn from it, and how they went (§18).

The shape is Jira's and Taiga's, on the platform's one work queue:

* **The backlog** is every open task in no sprint, in a hand-made order
  (`tasks.backlog_rank`, sparse and fractional like the board's — a drop writes
  one row).
* **A sprint** takes tasks from it. Planning is dragging: a task dropped into a
  sprint gets its `sprint_id`, and one dropped back loses it. Adding work to a
  sprint that has started is allowed and remembered (`sprint_added_at`), so the
  report can tell what was committed from what crept in.
* **Starting** freezes the commitment; **completing** freezes what was done and
  carries everything unfinished to the backlog, the next planned sprint, or a
  new one. Both numbers feed the velocity chart.
* **The burndown** reads one snapshot per day (`sprint_snapshots`), written by
  the scheduler and on every start/complete; today is always computed live.
"""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy import func, select

from src.core import audit
from src.core.clock import now
from src.core.errors import ConflictError, NotFoundError, ValidationError
from src.core.pagination import parse_uuid
from src.services.timeline import _person, as_day

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


# ── reading ──────────────────────────────────────────────────────────────


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


# ── writing ──────────────────────────────────────────────────────────────


def _body(payload: Any) -> dict[str, Any]:
    return payload if isinstance(payload, dict) else {}


def _capacity(raw: Any) -> Decimal | None:
    if raw is None or raw == "":
        return None
    try:
        value = Decimal(str(raw))
    except Exception as exc:  # noqa: BLE001 - any unparsable value is the same answer
        raise ValidationError("Capacity is a number of points.", details={"capacity_points": raw}) from exc
    if value < 0 or value > 9999:
        raise ValidationError("Capacity is between 0 and 9999 points.", details={"capacity_points": raw})
    return value


def create(session, payload: Any, *, principal) -> dict[str, Any]:
    from src.models.business import Project
    from src.models.planning import Sprint

    principal.require(MANAGE)
    body = _body(payload)
    project_id = parse_uuid(body["project_id"], field="project_id") if body.get("project_id") else None
    if project_id and session.get(Project, project_id) is None:
        raise NotFoundError("No project with that id.", details={"project_id": str(project_id)})
    count = session.scalar(
        select(func.count()).select_from(Sprint).where(Sprint.project_id == project_id)
    ) or 0
    name = (body.get("name") or "").strip() or f"Sprint {count + 1}"
    start = as_day(body.get("start_date"))
    end = as_day(body.get("end_date"))
    if start and not end:
        end = start + timedelta(days=DEFAULT_LENGTH_DAYS - 1)
    _check_window(start, end)
    row = Sprint(
        project_id=project_id,
        name=name[:120],
        goal=(body.get("goal") or None),
        state="PLANNED",
        start_date=start,
        end_date=end,
        capacity_points=_capacity(body.get("capacity_points")),
        created_by_id=principal.user_id,
    )
    session.add(row)
    session.flush()
    _audit(session, row, "CREATE", principal, f"planned {row.name}")
    return summary(session, row, [])


def _check_window(start: date | None, end: date | None) -> None:
    if start and end and end < start:
        raise ValidationError(
            "A sprint cannot end before it starts.",
            details={"start_date": start.isoformat(), "end_date": end.isoformat()},
        )


def update(session, sprint_id: Any, payload: Any, *, principal) -> dict[str, Any]:
    principal.require(MANAGE)
    row = _sprint(session, sprint_id)
    body = _body(payload)
    if "name" in body:
        name = (body.get("name") or "").strip()
        if not name:
            raise ValidationError("A sprint needs a name.", details={"name": ""})
        row.name = name[:120]
    if "goal" in body:
        row.goal = body.get("goal") or None
    if "start_date" in body:
        row.start_date = as_day(body.get("start_date"))
    if "end_date" in body:
        row.end_date = as_day(body.get("end_date"))
    if "capacity_points" in body:
        row.capacity_points = _capacity(body.get("capacity_points"))
    _check_window(row.start_date, row.end_date)
    session.flush()
    _audit(session, row, "UPDATE", principal, f"changed {row.name}")
    return summary(session, row)


def remove(session, sprint_id: Any, *, principal) -> dict[str, Any]:
    """Delete a sprint that has not started; its tasks go back to the backlog."""
    principal.require(MANAGE)
    row = _sprint(session, sprint_id)
    if row.state != "PLANNED":
        raise ConflictError(
            "Only a sprint that has not started can be deleted — complete it instead.",
            details={"state": row.state},
        )
    released = 0
    for task in _scope(session, row.id):
        task.sprint_id = None
        task.sprint_added_at = None
        released += 1
    row.deleted_at = now()
    session.flush()
    _audit(session, row, "DELETE", principal, f"deleted {row.name}")
    return {"id": str(row.id), "deleted": True, "released": released}


def start(session, sprint_id: Any, payload: Any, *, principal) -> dict[str, Any]:
    from src.models.planning import Sprint

    principal.require(MANAGE)
    row = _sprint(session, sprint_id)
    if row.state != "PLANNED":
        raise ConflictError(f"{row.name} has already started.", details={"state": row.state})
    running = session.scalars(
        select(Sprint).where(
            Sprint.deleted_at.is_(None), Sprint.state == "ACTIVE",
            Sprint.project_id == row.project_id if row.project_id else Sprint.project_id.is_(None),
        )
    ).first()
    if running is not None:
        raise ConflictError(
            f"{running.name} is still running — complete it before starting another.",
            details={"active_sprint_id": str(running.id)},
        )
    body = _body(payload)
    today = now().date()
    row.start_date = as_day(body.get("start_date")) or row.start_date or today
    row.end_date = as_day(body.get("end_date")) or row.end_date or row.start_date + timedelta(days=DEFAULT_LENGTH_DAYS - 1)
    if body.get("goal"):
        row.goal = body["goal"]
    _check_window(row.start_date, row.end_date)
    tasks = _scope(session, row.id)
    row.state = "ACTIVE"
    row.started_at = now()
    row.committed_points = Decimal(str(stats(tasks)["total_points"]))
    session.flush()
    snapshot(session, row, today)
    _audit(session, row, "UPDATE", principal, f"started {row.name}")
    return summary(session, row, tasks)


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


def snapshot(session, row, day: date) -> None:
    """Record (or refresh) one day of a sprint's burndown."""
    from src.models.planning import SprintSnapshot

    numbers = stats(_scope(session, row.id))
    existing = session.scalars(
        select(SprintSnapshot).where(SprintSnapshot.sprint_id == row.id, SprintSnapshot.day == day)
    ).first()
    if existing is None:
        existing = SprintSnapshot(sprint_id=row.id, day=day)
        session.add(existing)
    existing.total_points = Decimal(str(numbers["total_points"]))
    existing.done_points = Decimal(str(numbers["done_points"]))
    existing.remaining_points = Decimal(str(numbers["remaining_points"]))
    existing.total_tasks = numbers["total_tasks"]
    existing.done_tasks = numbers["done_tasks"]
    session.flush()


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


def place(session, payload: Any, *, principal) -> dict[str, Any]:
    """Drop a task into a sprint or the backlog, between two neighbours."""
    from src.models.business import Task

    principal.require(MANAGE)
    body = _body(payload)
    task = session.scalars(
        select(Task).where(
            Task.id == parse_uuid(body.get("task_id"), field="task_id"), Task.deleted_at.is_(None)
        )
    ).unique().first()
    if task is None:
        raise NotFoundError("No task with that id.", details={"task_id": str(body.get("task_id"))})
    sprint = _sprint(session, body["sprint_id"]) if body.get("sprint_id") else None
    if sprint is not None and sprint.state == "COMPLETED":
        raise ConflictError(f"{sprint.name} is finished; plan into a later sprint.", details={"state": sprint.state})

    before_sprint = task.sprint_id
    target = sprint.id if sprint else None
    if before_sprint != target:
        task.sprint_id = target
        task.sprint_added_at = now() if target else None

    container = select(Task).where(
        Task.deleted_at.is_(None), Task.id != task.id,
        Task.sprint_id == target if target else Task.sprint_id.is_(None),
    )
    after = _neighbour(session, body.get("after_id"), task)
    before = _neighbour(session, body.get("before_id"), task)
    rank = _rank(session, container, after, before)
    if rank is None:
        rows = session.scalars(container.order_by(Task.backlog_rank.asc(), Task.id.asc())).unique().all()
        for index, item in enumerate(rows, start=1):
            item.backlog_rank = index * STEP
        session.flush()
        rank = _rank(session, container, after, before)
    task.backlog_rank = rank if rank is not None else STEP
    session.flush()

    if before_sprint != target:
        audit.record(
            session, action="UPDATE", resource_type="task", resource_id=task.id,
            resource_label=task.reference, principal=principal,
            before={"sprint_id": str(before_sprint) if before_sprint else None},
            after={"sprint_id": str(target) if target else None},
            message=f"moved {task.reference} to {sprint.name if sprint else 'the backlog'}",
        )
    return card(task)


def _neighbour(session, raw: Any, task):
    from src.models.business import Task

    if not raw:
        return None
    identifier = parse_uuid(raw, field="neighbour")
    if identifier == task.id:
        raise ValidationError("A task cannot be placed next to itself.", details={"neighbour": str(raw)})
    row = session.scalars(select(Task).where(Task.id == identifier, Task.deleted_at.is_(None))).unique().first()
    if row is None or row.sprint_id != task.sprint_id:
        return None
    return row


def _rank(session, container, after, before) -> float | None:
    from src.models.business import Task

    if after is not None and before is None:
        before = session.scalars(
            container.where(Task.backlog_rank > after.backlog_rank).order_by(Task.backlog_rank.asc())
        ).unique().first()
    elif before is not None and after is None:
        after = session.scalars(
            container.where(Task.backlog_rank < before.backlog_rank).order_by(Task.backlog_rank.desc())
        ).unique().first()
    elif after is None and before is None:
        before = session.scalars(container.order_by(Task.backlog_rank.asc())).unique().first()
    low = float(after.backlog_rank) if after is not None else None
    high = float(before.backlog_rank) if before is not None else None
    if low is None and high is None:
        return STEP
    if high is None:
        return low + STEP
    if low is None:
        return high - STEP
    if high - low <= _MIN_GAP:
        return None
    return low + (high - low) / 2


def _audit(session, row, action: str, principal, message: str) -> None:
    audit.record(
        session, action=action, resource_type="sprint", resource_id=row.id,
        resource_label=row.name, principal=principal,
        after={"state": row.state, "name": row.name}, message=message,
        project_id=row.project_id,
    )
