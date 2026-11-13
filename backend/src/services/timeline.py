"""The timeline: tasks as bars in time, with the dependencies between them (§18).

A Gantt chart answers "what happens when, and what waits on what". It reads
the same `tasks` rows the board does — a bar is a task's `start_date` to its
`due_date` — and adds one table of its own, `task_dependencies`, which is
finish-to-start: the successor may begin the day after the predecessor ends,
plus a lag.

Three writes, each small and audited exactly as an edit of the same field
would be:

* **schedule** — a bar dragged or resized. The dates are written through
  `record_writes.apply_values`, and the answer says which dependencies the new
  dates break. Breaking one is allowed (a plan is a plan, not a proof); the
  reader is told, and offered `shift_dependants`, which moves every task
  downstream just far enough, keeping each one's length.
* **link** — a dependency drawn from one bar's end to another. A cycle is
  refused, because a plan in which A waits on B waits on A has no schedule.
* **unlink**.

The **critical path** is computed, not stored: the chain of linked tasks with
no slack, by the classic forward/backward pass over each linked component.
"""

from __future__ import annotations

from collections import defaultdict, deque
from datetime import date, datetime, time, timedelta, timezone
from typing import Any

from sqlalchemy import and_, or_, select

from src.core import audit
from src.core.clock import now
from src.core.errors import ConflictError, NotFoundError, ValidationError
from src.core.pagination import parse_uuid
from src.core.repository import get_or_404
from src.services import record_writes
from src.services.explorer import resource_for

#: The most bars one timeline draws. A Gantt chart of two thousand rows is a
#: texture, not a plan; the reader narrows by project instead.
MAX_BARS = 400
GROUPINGS = ("project", "epic", "assignee")
CLOSED = ("DONE", "CANCELLED")


# ── dates ────────────────────────────────────────────────────────────────


def as_day(value: Any) -> date | None:
    """A date from a datetime, a date or an ISO string."""
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc).date() if value.tzinfo else value.date()
    if isinstance(value, date):
        return value
    text = str(value).strip()
    try:
        return date.fromisoformat(text[:10])
    except ValueError as exc:
        raise ValidationError(f"{text!r} is not a date.", details={"value": text}) from exc


def at_midnight(day: date) -> datetime:
    return datetime.combine(day, time(0, 0), tzinfo=timezone.utc)


def span_of(task) -> tuple[date, date, bool]:
    """Where a task's bar runs, and whether both ends were actually planned.

    A task with only a due date is drawn ending there, as long as its estimate
    says (a working day per eight hours, at least one); one with neither is
    drawn as a day where it was created, and marked unscheduled.
    """
    start = as_day(task.start_date)
    end = as_day(task.due_date)
    planned = start is not None and end is not None
    if end is None and start is None:
        start = end = as_day(task.created_at) or now().date()
    elif start is None:
        hours = float(task.estimate_hours or 8)
        start = end - timedelta(days=max(0, round(hours / 8) - 1))
    elif end is None:
        end = start
    if end < start:
        end = start
    return start, end, planned


def violates(pred_end: date, succ_start: date, lag: int) -> bool:
    """Finish-to-start: the successor starts the day after, plus the lag."""
    return succ_start <= pred_end + timedelta(days=lag)


# ── reading ──────────────────────────────────────────────────────────────


def timeline(session, args: dict[str, Any], *, principal) -> dict[str, Any]:
    """Bars, groups, dependencies and the critical path for a window of time."""
    from src.models.business import Project, Task
    from src.models.planning import TaskDependency

    principal.require("tasks.view")
    group = (args.get("group") or "project").lower()
    if group not in GROUPINGS:
        raise ValidationError(
            f"A timeline groups by {', '.join(GROUPINGS)}.", details={"group": group}
        )
    today = now().date()
    start = as_day(args.get("from")) or today - timedelta(days=30)
    end = as_day(args.get("to")) or today + timedelta(days=120)
    if end < start:
        raise ValidationError("The window ends before it starts.", details={"from": str(start), "to": str(end)})
    project_ids = [parse_uuid(item, field="project_id") for item in _many(args.get("project_id"))]
    include_done = str(args.get("include_done", "true")).lower() not in ("false", "0", "no")
    term = (args.get("q") or "").strip()

    lo, hi = at_midnight(start), at_midnight(end + timedelta(days=1))
    statement = select(Task).where(Task.deleted_at.is_(None), Task.status != "CANCELLED")
    if project_ids:
        statement = statement.where(Task.project_id.in_(project_ids))
    else:
        # Anything whose bar touches the window: started before it ends and
        # due after it begins — with a missing end standing in for the other.
        statement = statement.where(
            or_(
                and_(Task.start_date < hi, Task.due_date >= lo),
                and_(Task.start_date.is_(None), Task.due_date >= lo, Task.due_date < hi),
                and_(Task.due_date.is_(None), Task.start_date >= lo, Task.start_date < hi),
            )
        )
    if not include_done:
        statement = statement.where(Task.status != "DONE")
    if term:
        like = f"%{term}%"
        statement = statement.where(or_(Task.title.ilike(like), Task.reference.ilike(like)))
    statement = statement.order_by(Task.start_date.asc().nulls_last(), Task.due_date.asc().nulls_last(), Task.reference)
    rows = session.scalars(statement.limit(MAX_BARS + 1)).unique().all()
    truncated = len(rows) > MAX_BARS
    rows = rows[:MAX_BARS]
    ids = [row.id for row in rows]

    links = session.scalars(
        select(TaskDependency).where(
            TaskDependency.predecessor_id.in_(ids), TaskDependency.successor_id.in_(ids)
        )
    ).all() if ids else []

    spans = {row.id: span_of(row) for row in rows}
    critical = critical_path(
        {key: (value[0], value[1]) for key, value in spans.items()},
        [(link.predecessor_id, link.successor_id, link.lag_days) for link in links],
    )

    epic_ids = {row.epic_id for row in rows if row.epic_id}
    epics = {
        item.id: item
        for item in session.scalars(select(Task).where(Task.id.in_(epic_ids))).all()
    } if epic_ids else {}
    project_rows = {
        item.id: item
        for item in session.scalars(
            select(Project).where(Project.id.in_({row.project_id for row in rows if row.project_id}))
        ).unique().all()
    } if rows else {}

    def bar(row) -> dict[str, Any]:
        first, last, planned = spans[row.id]
        return {
            "id": str(row.id),
            "reference": row.reference,
            "title": row.title,
            "status": row.status,
            "priority": row.priority,
            "kind": row.kind,
            "start": first.isoformat(),
            "end": last.isoformat(),
            "scheduled": planned,
            "progress": int(row.progress or 0),
            "is_milestone": bool(row.is_milestone),
            "story_points": float(row.story_points) if row.story_points is not None else None,
            "project_id": str(row.project_id) if row.project_id else None,
            "epic_id": str(row.epic_id) if row.epic_id else None,
            "assignee": _person(row.assignee),
            "cover_color": row.cover_color,
            "critical": row.id in critical,
            "updated_at": row.updated_at.isoformat() if row.updated_at else None,
        }

    buckets: dict[str, dict[str, Any]] = {}
    for row in rows:
        if group == "project":
            project = project_rows.get(row.project_id)
            key = str(row.project_id) if project else "none"
            if key not in buckets:
                buckets[key] = {
                    "key": key,
                    "label": project.name if project else "No project",
                    "code": project.code if project else None,
                    "color": project.color if project else None,
                    "start": as_day(project.start_date).isoformat() if project and project.start_date else None,
                    "end": as_day(project.due_date).isoformat() if project and project.due_date else None,
                    "progress": int(project.progress or 0) if project else None,
                    "items": [],
                }
        elif group == "epic":
            epic = epics.get(row.epic_id)
            if row.kind == "EPIC":
                epic = row
            key = str(epic.id) if epic else "none"
            if key not in buckets:
                buckets[key] = {
                    "key": key,
                    "label": epic.title if epic else "No epic",
                    "code": epic.reference if epic else None,
                    "color": epic.cover_color if epic else None,
                    "start": None, "end": None, "progress": int(epic.progress or 0) if epic else None,
                    "items": [],
                }
        else:
            person = row.assignee
            key = str(person.id) if person else "none"
            if key not in buckets:
                buckets[key] = {
                    "key": key,
                    "label": _name(person) if person else "Unassigned",
                    "code": None, "color": None, "start": None, "end": None, "progress": None,
                    "items": [],
                }
        buckets[key]["items"].append(bar(row))

    groups = sorted(buckets.values(), key=lambda item: (item["key"] == "none", item["label"].lower()))
    for item in groups:
        firsts = [entry["start"] for entry in item["items"]]
        lasts = [entry["end"] for entry in item["items"]]
        item["start"] = item["start"] or min(firsts)
        item["end"] = item["end"] or max(lasts)
        item["count"] = len(item["items"])

    return {
        "group": group,
        "range": {"from": start.isoformat(), "to": end.isoformat(), "today": today.isoformat()},
        "groups": groups,
        "dependencies": [
            _link(link, spans)
            for link in links
        ],
        "critical_path": [str(item) for item in ids if item in critical],
        "total": len(rows),
        "truncated": truncated,
        "can_edit": principal.can(record_writes.UPDATE_PERMISSION),
    }


def _many(raw: Any) -> list[str]:
    if raw is None or raw == "":
        return []
    if isinstance(raw, (list, tuple)):
        return [str(item) for item in raw if item]
    return [item for item in str(raw).split(",") if item]


def _name(user) -> str:
    if user is None:
        return ""
    full = getattr(user, "full_name", None) or " ".join(
        part for part in (getattr(user, "first_name", ""), getattr(user, "last_name", "")) if part
    )
    return full or getattr(user, "username", "") or getattr(user, "email", "")


def _person(user) -> dict[str, Any] | None:
    if user is None:
        return None
    name = _name(user)
    initials = "".join(part[0] for part in name.split()[:2]).upper() if name else "?"
    return {"id": str(user.id), "name": name, "initials": initials}


def _link(link, spans) -> dict[str, Any]:
    pred = spans.get(link.predecessor_id)
    succ = spans.get(link.successor_id)
    broken = bool(pred and succ and violates(pred[1], succ[0], link.lag_days))
    return {
        "id": str(link.id),
        "predecessor_id": str(link.predecessor_id),
        "successor_id": str(link.successor_id),
        "kind": link.kind,
        "lag_days": link.lag_days,
        "violated": broken,
    }


def critical_path(
    spans: dict[Any, tuple[date, date]], links: list[tuple[Any, Any, int]]
) -> set[Any]:
    """The tasks with no slack, over every linked component.

    Forward pass: a task starts at the later of its own planned start and the
    day after each predecessor (plus lag) finishes. Backward pass from the
    latest finish. A task is critical when its latest start equals its
    earliest — and only tasks that take part in a dependency are considered,
    because a lone bar is trivially "critical" and says nothing.
    """
    linked = {item for pred, succ, _lag in links for item in (pred, succ) if item in spans}
    if not linked:
        return set()
    successors: dict[Any, list[tuple[Any, int]]] = defaultdict(list)
    predecessors: dict[Any, list[tuple[Any, int]]] = defaultdict(list)
    for pred, succ, lag in links:
        if pred in linked and succ in linked:
            successors[pred].append((succ, lag))
            predecessors[succ].append((pred, lag))

    order = _topological(linked, successors, predecessors)
    if order is None:  # a cycle: nothing is reliably critical
        return set()

    length = {item: (spans[item][1] - spans[item][0]).days + 1 for item in linked}
    earliest: dict[Any, int] = {}
    origin = min(spans[item][0] for item in linked)
    for item in order:
        start = (spans[item][0] - origin).days
        for pred, lag in predecessors[item]:
            start = max(start, earliest[pred] + length[pred] + lag)
        earliest[item] = start
    finish = max(earliest[item] + length[item] for item in linked)
    latest: dict[Any, int] = {}
    for item in reversed(order):
        late_finish = finish
        for succ, lag in successors[item]:
            late_finish = min(late_finish, latest[succ] - lag)
        latest[item] = late_finish - length[item]
    return {item for item in linked if latest[item] - earliest[item] <= 0}


def _topological(nodes, successors, predecessors) -> list[Any] | None:
    incoming = {item: len(predecessors[item]) for item in nodes}
    queue = deque(sorted((item for item in nodes if incoming[item] == 0), key=str))
    order: list[Any] = []
    while queue:
        item = queue.popleft()
        order.append(item)
        for succ, _lag in successors[item]:
            incoming[succ] -= 1
            if incoming[succ] == 0:
                queue.append(succ)
    return order if len(order) == len(nodes) else None


# ── writing ──────────────────────────────────────────────────────────────


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


def link(session, payload: Any, *, principal) -> dict[str, Any]:
    """Draw a finish-to-start dependency between two tasks."""
    from src.models.planning import TaskDependency

    principal.require(record_writes.UPDATE_PERMISSION)
    body = payload if isinstance(payload, dict) else {}
    pred = _task(session, body.get("predecessor_id"), "predecessor_id")
    succ = _task(session, body.get("successor_id"), "successor_id")
    if pred.id == succ.id:
        raise ValidationError("A task cannot wait on itself.", details={"task_id": str(pred.id)})
    try:
        lag = int(body.get("lag_days") or 0)
    except (TypeError, ValueError) as exc:
        raise ValidationError("The lag is a whole number of days.", details={"lag_days": body.get("lag_days")}) from exc
    if not -365 <= lag <= 365:
        raise ValidationError("The lag is at most a year either way.", details={"lag_days": lag})
    existing = session.scalars(
        select(TaskDependency).where(
            TaskDependency.predecessor_id == pred.id, TaskDependency.successor_id == succ.id
        )
    ).first()
    if existing is not None:
        raise ConflictError(
            f"{succ.reference} already waits on {pred.reference}.",
            details={"dependency_id": str(existing.id)},
        )
    if _reaches(session, succ.id, pred.id):
        raise ValidationError(
            f"{pred.reference} already waits on {succ.reference}, so this would be a loop.",
            details={"predecessor_id": str(pred.id), "successor_id": str(succ.id)},
        )
    row = TaskDependency(
        predecessor_id=pred.id, successor_id=succ.id, kind="FS", lag_days=lag,
        created_by_id=principal.user_id,
    )
    session.add(row)
    session.flush()
    audit.record(
        session, action="UPDATE", resource_type="task", resource_id=succ.id,
        resource_label=succ.reference, principal=principal,
        after={"waits_on": pred.reference, "lag_days": lag},
        message=f"made {succ.reference} wait on {pred.reference}",
    )
    spans = {pred.id: span_of(pred), succ.id: span_of(succ)}
    return _link(row, spans) | {
        "predecessor": {"reference": pred.reference, "title": pred.title},
        "successor": {"reference": succ.reference, "title": succ.title},
    }


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


def unlink(session, dependency_id: Any, *, principal) -> dict[str, Any]:
    from src.models.planning import TaskDependency

    principal.require(record_writes.UPDATE_PERMISSION)
    identifier = parse_uuid(dependency_id, field="dependency_id")
    row = get_or_404(
        session,
        TaskDependency,
        identifier,
        "No dependency with that id.",
        details={"dependency_id": str(dependency_id)},
    )
    succ = _task(session, row.successor_id)
    pred = _task(session, row.predecessor_id)
    session.delete(row)
    session.flush()
    audit.record(
        session, action="UPDATE", resource_type="task", resource_id=succ.id,
        resource_label=succ.reference, principal=principal,
        before={"waits_on": pred.reference},
        message=f"{succ.reference} no longer waits on {pred.reference}",
    )
    return {"id": str(identifier), "deleted": True}
