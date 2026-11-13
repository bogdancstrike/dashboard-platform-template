"""Templates, recurring tasks, and the scheduler that makes the next one (§18, §23).

**A template** is a task that has not happened yet: a title, a description, a
checklist, an estimate, points, labels and how long after creation it is due.
"New from template" creates a real task through the records API's own create —
named, validated and audited like one typed into the form — and "save as
template" goes the other way.

**A recurrence** is a rule set on a task: daily, weekly (on chosen weekdays),
monthly (on a day of the month) or every N days/weeks. When the rule comes due
the scheduler copies the task — fresh status, unticked checklist, the same
length between start and due — and moves the rule on to its next date.

**The scheduler** is two jobs in the platform's own jobs system
(`scheduled_tasks` + `background_jobs`): `work.recurring-tasks` and
`work.sprint-snapshots`. There is no worker process (see `core/background`),
so a run is started either by "Run now" (`POST /api/work/scheduler/run`) or,
lazily, by the first planning request after the job's `next_run_at` — spawned
off that request, recorded as a job like any other, visible at /admin/jobs.
"""

from __future__ import annotations

import calendar
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Any

from sqlalchemy import select

from src.core import audit
from src.core.clock import now
from src.core.errors import NotFoundError, ValidationError
from src.core.pagination import parse_uuid
from src.services.records import writes as record_writes
from src.services.work.sprints import MANAGE, READ, _points
from src.services.work.timeline import _task, as_day, at_midnight

FREQUENCIES = ("DAILY", "WEEKLY", "MONTHLY", "CUSTOM")
UNITS = ("DAY", "WEEK")
WEEKDAY_NAMES = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")
#: A run makes at most this many occurrences per rule — a rule left untouched
#: for a year must not flood the board with a year of copies in one go.
MAX_CATCH_UP = 3

JOBS = {
    "work.recurring-tasks": ("Recurring tasks", "0 * * * *", "RECURRENCE", timedelta(hours=1)),
    "work.sprint-snapshots": ("Sprint burndown snapshots", "5 0 * * *", "SNAPSHOT", timedelta(hours=6)),
}


# ── templates ────────────────────────────────────────────────────────────


def _template(session, template_id: Any):
    from src.models.planning import TaskTemplate

    identifier = parse_uuid(template_id, field="template_id")
    row = session.scalars(
        select(TaskTemplate).where(TaskTemplate.id == identifier, TaskTemplate.deleted_at.is_(None))
    ).first()
    if row is None:
        raise NotFoundError("No template with that id.", details={"template_id": str(template_id)})
    return row


def _checklist(raw: Any) -> list[dict[str, Any]]:
    if raw in (None, ""):
        return []
    if not isinstance(raw, list):
        raise ValidationError("A checklist is a list of steps.", details={"checklist": raw})
    items = []
    for item in raw[: record_writes.MAX_ITEMS]:
        text = item.get("text") if isinstance(item, dict) else item
        text = str(text or "").strip()[: record_writes.MAX_ITEM_CHARS]
        if text:
            items.append({"text": text, "done": False})
    return items


def serialize_template(row) -> dict[str, Any]:
    return {
        "id": str(row.id),
        "name": row.name,
        "title": row.title,
        "description": row.description,
        "kind": row.kind,
        "priority": row.priority,
        "estimate_hours": float(row.estimate_hours) if row.estimate_hours is not None else None,
        "story_points": _points(row.story_points) if row.story_points is not None else None,
        "checklist": row.checklist or [],
        "labels": list(row.labels or []),
        "cover_color": row.cover_color,
        "due_in_days": row.due_in_days,
        "usage_count": row.usage_count,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


def templates(session, args: dict[str, Any], *, principal) -> dict[str, Any]:
    from src.models.planning import TaskTemplate

    principal.require(READ)
    statement = select(TaskTemplate).where(TaskTemplate.deleted_at.is_(None))
    term = (args.get("q") or "").strip()
    if term:
        statement = statement.where(TaskTemplate.name.ilike(f"%{term}%") | TaskTemplate.title.ilike(f"%{term}%"))
    rows = session.scalars(statement.order_by(TaskTemplate.usage_count.desc(), TaskTemplate.name)).all()
    return {
        "items": [serialize_template(row) for row in rows],
        "can_manage": principal.can(MANAGE),
    }


def _apply_fields(row, body: dict[str, Any], *, creating: bool) -> None:
    from src.core import vocabulary

    if creating or "name" in body:
        name = str(body.get("name") or "").strip()
        if not name:
            raise ValidationError("A template needs a name.", details={"field": "name"})
        row.name = name[:120]
    if creating or "title" in body:
        title = str(body.get("title") or body.get("name") or "").strip()
        if not title:
            raise ValidationError("A template needs the title its tasks get.", details={"field": "title"})
        row.title = title[:240]
    if "description" in body:
        row.description = body.get("description") or None
    if "kind" in body or creating:
        kind = str(body.get("kind") or "TASK").upper()
        if kind not in vocabulary.TASK_KIND:
            raise ValidationError(f"{kind} is not a kind of task.", details={"field": "kind"})
        row.kind = kind
    if "priority" in body or creating:
        priority = str(body.get("priority") or "NORMAL").upper()
        if priority not in vocabulary.PRIORITY:
            raise ValidationError(f"{priority} is not a priority.", details={"field": "priority"})
        row.priority = priority
    for name, top in (("estimate_hours", 10_000), ("story_points", 999)):
        if name in body:
            raw = body.get(name)
            if raw in (None, ""):
                setattr(row, name, None)
                continue
            try:
                value = Decimal(str(raw))
            except Exception as exc:  # noqa: BLE001
                raise ValidationError(f"{name.replace('_', ' ')} must be a number.", details={"field": name}) from exc
            if value < 0 or value > top:
                raise ValidationError(f"{name.replace('_', ' ')} is out of range.", details={"field": name})
            setattr(row, name, value)
    if "checklist" in body:
        row.checklist = _checklist(body.get("checklist")) or None
    if "labels" in body:
        labels = body.get("labels") or []
        if not isinstance(labels, list):
            raise ValidationError("Labels are a list.", details={"field": "labels"})
        row.labels = [str(item)[:48] for item in labels][:12] or None
    if "cover_color" in body:
        row.cover_color = (str(body.get("cover_color") or "")[:16]) or None
    if "due_in_days" in body:
        raw = body.get("due_in_days")
        if raw in (None, ""):
            row.due_in_days = None
        else:
            try:
                days = int(raw)
            except (TypeError, ValueError) as exc:
                raise ValidationError("Due in is a number of days.", details={"field": "due_in_days"}) from exc
            if days < 0 or days > 3650:
                raise ValidationError("Due in is between 0 and 3650 days.", details={"field": "due_in_days"})
            row.due_in_days = days


def create_template(session, payload: Any, *, principal) -> dict[str, Any]:
    from src.models.planning import TaskTemplate

    principal.require(MANAGE)
    body = payload if isinstance(payload, dict) else {}
    row = TaskTemplate(owner_id=principal.user_id, usage_count=0)
    _apply_fields(row, body, creating=True)
    session.add(row)
    session.flush()
    _audit_template(session, row, "CREATE", principal, f"created the task template {row.name}")
    return serialize_template(row)


def update_template(session, template_id: Any, payload: Any, *, principal) -> dict[str, Any]:
    principal.require(MANAGE)
    row = _template(session, template_id)
    _apply_fields(row, payload if isinstance(payload, dict) else {}, creating=False)
    session.flush()
    _audit_template(session, row, "UPDATE", principal, f"changed the task template {row.name}")
    return serialize_template(row)


def remove_template(session, template_id: Any, *, principal) -> dict[str, Any]:
    principal.require(MANAGE)
    row = _template(session, template_id)
    row.deleted_at = now()
    session.flush()
    _audit_template(session, row, "DELETE", principal, f"deleted the task template {row.name}")
    return {"id": str(row.id), "deleted": True}


def template(session, template_id: Any, *, principal) -> dict[str, Any]:
    principal.require(READ)
    return serialize_template(_template(session, template_id))


def use_template(session, template_id: Any, payload: Any, *, principal) -> dict[str, Any]:
    """Create a real task from a template, through the records API's own create."""
    row = _template(session, template_id)
    body = payload if isinstance(payload, dict) else {}
    values: dict[str, Any] = {
        "title": (body.get("title") or row.title),
        "description": row.description,
        "kind": row.kind,
        "priority": row.priority,
        "status": body.get("status") or "NEW",
        "estimate_hours": float(row.estimate_hours) if row.estimate_hours is not None else None,
        "story_points": float(row.story_points) if row.story_points is not None else None,
        "checklist": [{"text": item.get("text", ""), "done": False} for item in (row.checklist or [])] or None,
        "cover_color": row.cover_color,
    }
    for name in ("project_id", "assignee_id", "epic_id", "parent_id"):
        if body.get(name):
            values[name] = body[name]
    start = as_day(body.get("start_date")) or now().date()
    values["start_date"] = at_midnight(start).isoformat()
    if row.due_in_days is not None:
        values["due_date"] = at_midnight(start + timedelta(days=row.due_in_days)).isoformat()
    created = record_writes.create(
        session, "task", {key: value for key, value in values.items() if value is not None},
        principal=principal,
    )
    row.usage_count = (row.usage_count or 0) + 1
    _label(session, created["id"], row.labels, principal=principal)
    session.flush()
    return created


def _label(session, task_id: str, labels, *, principal) -> None:
    """Put the template's labels on the copy — the ones the vocabulary knows."""
    if not labels:
        return
    from src.models.content import Tag
    from src.services.records import tags

    if not principal.can(tags.APPLY_PERMISSION):
        return
    slugs = [tags.slugify(item) for item in labels]
    known = session.scalars(select(Tag.slug).where(Tag.slug.in_(slugs))).all()
    if known:
        tags.apply(session, "task", task_id, {"tags": list(known)}, principal=principal)


def save_as_template(session, task_id: Any, payload: Any, *, principal) -> dict[str, Any]:
    principal.require(MANAGE)
    task = _task(session, task_id)
    body = payload if isinstance(payload, dict) else {}
    first, last = as_day(task.start_date), as_day(task.due_date)
    data = {
        "name": body.get("name") or task.title,
        "title": task.title,
        "description": task.description,
        "kind": task.kind if task.kind != "EPIC" else "TASK",
        "priority": task.priority,
        "estimate_hours": task.estimate_hours,
        "story_points": task.story_points,
        "checklist": task.checklist or [],
        "labels": list(task.tags or []),
        "cover_color": task.cover_color,
        "due_in_days": (last - first).days if first and last else None,
    }
    return create_template(session, data, principal=principal)


def _audit_template(session, row, action, principal, message) -> None:
    audit.record(
        session, action=action, resource_type="task_template", resource_id=row.id,
        resource_label=row.name, principal=principal, after={"name": row.name},
        message=message, activity=False,
    )


# ── recurrence ───────────────────────────────────────────────────────────


def next_after(rule, moment: datetime) -> datetime | None:
    """The first occurrence strictly after `moment`, or None past `until`."""
    day = moment.astimezone(timezone.utc).date() if moment.tzinfo else moment.date()
    frequency = rule.frequency
    interval = max(1, int(rule.interval or 1))
    if frequency == "DAILY":
        candidate = day + timedelta(days=interval)
    elif frequency == "WEEKLY":
        weekdays = sorted(set(rule.weekdays or [])) or [day.weekday()]
        candidate = None
        for offset in range(1, 7 * interval + 8):
            probe = day + timedelta(days=offset)
            if probe.weekday() not in weekdays:
                continue
            # With an interval above one, only weeks a multiple away count.
            week_gap = (probe - timedelta(days=probe.weekday()) - (day - timedelta(days=day.weekday()))).days // 7
            if week_gap % interval == 0:
                candidate = probe
                break
    elif frequency == "MONTHLY":
        target = rule.month_day or day.day

        def on(year: int, month: int) -> date:
            return date(year, month, min(target, calendar.monthrange(year, month)[1]))

        candidate = on(day.year, day.month)
        if candidate <= day:
            year, month = day.year, day.month + interval
            while month > 12:
                year, month = year + 1, month - 12
            candidate = on(year, month)
    else:  # CUSTOM
        step = interval * (7 if rule.unit == "WEEK" else 1)
        candidate = day + timedelta(days=step)
    if candidate is None:  # pragma: no cover - a weekday is always found in range
        return None
    if rule.until and candidate > rule.until:
        return None
    return datetime.combine(candidate, datetime.min.time().replace(hour=6), tzinfo=timezone.utc)


def describe_rule(rule) -> dict[str, Any]:
    interval = max(1, int(rule.interval or 1))
    if rule.frequency == "DAILY":
        text = "Every day" if interval == 1 else f"Every {interval} days"
    elif rule.frequency == "WEEKLY":
        days = ", ".join(WEEKDAY_NAMES[item] for item in sorted(set(rule.weekdays or []))) or "the same weekday"
        text = (f"Every week on {days}" if interval == 1 else f"Every {interval} weeks on {days}")
    elif rule.frequency == "MONTHLY":
        text = (
            f"Every month on day {rule.month_day}" if interval == 1
            else f"Every {interval} months on day {rule.month_day}"
        )
    else:
        unit = "week" if rule.unit == "WEEK" else "day"
        text = f"Every {interval} {unit}{'s' if interval != 1 else ''}"
    if rule.until:
        text += f", until {rule.until.isoformat()}"
    return {
        "id": str(rule.id),
        "frequency": rule.frequency,
        "interval": interval,
        "unit": rule.unit,
        "weekdays": list(rule.weekdays or []),
        "month_day": rule.month_day,
        "until": rule.until.isoformat() if rule.until else None,
        "next_run_at": rule.next_run_at.isoformat() if rule.next_run_at else None,
        "last_run_at": rule.last_run_at.isoformat() if rule.last_run_at else None,
        "occurrences": rule.occurrences,
        "active": rule.active,
        "summary": text,
    }


def recurrence(session, task_id: Any, *, principal) -> dict[str, Any]:
    from src.models.planning import TaskRecurrence

    principal.require(READ)
    task = _task(session, task_id)
    rule = session.scalars(select(TaskRecurrence).where(TaskRecurrence.task_id == task.id)).first()
    return {"recurrence": describe_rule(rule) if rule else None}


def set_recurrence(session, task_id: Any, payload: Any, *, principal) -> dict[str, Any]:
    from src.models.planning import TaskRecurrence

    principal.require(MANAGE)
    task = _task(session, task_id)
    body = payload if isinstance(payload, dict) else {}
    frequency = str(body.get("frequency") or "WEEKLY").upper()
    if frequency not in FREQUENCIES:
        raise ValidationError(f"A task recurs {', '.join(FREQUENCIES).lower()}.", details={"frequency": frequency})
    try:
        raw_interval = body.get("interval")
        interval = 1 if raw_interval in (None, "") else int(raw_interval)
    except (TypeError, ValueError) as exc:
        raise ValidationError("The interval is a whole number.", details={"interval": body.get("interval")}) from exc
    if not 1 <= interval <= 365:
        raise ValidationError("The interval is between 1 and 365.", details={"interval": interval})
    unit = str(body.get("unit") or "DAY").upper()
    if unit not in UNITS:
        raise ValidationError("A custom rule counts days or weeks.", details={"unit": unit})
    weekdays = body.get("weekdays") or []
    if not isinstance(weekdays, list) or any(not isinstance(item, int) or not 0 <= item <= 6 for item in weekdays):
        raise ValidationError("Weekdays are numbers from 0 (Monday) to 6.", details={"weekdays": weekdays})
    month_day = body.get("month_day")
    if frequency == "MONTHLY":
        try:
            month_day = int(month_day or as_day(task.due_date or task.created_at).day)
        except (TypeError, ValueError) as exc:
            raise ValidationError("The day of the month is a number.", details={"month_day": month_day}) from exc
        if not 1 <= month_day <= 31:
            raise ValidationError("The day of the month is between 1 and 31.", details={"month_day": month_day})
    else:
        month_day = None

    rule = session.scalars(select(TaskRecurrence).where(TaskRecurrence.task_id == task.id)).first()
    if rule is None:
        rule = TaskRecurrence(task_id=task.id, created_by_id=principal.user_id, occurrences=0)
        session.add(rule)
    rule.frequency = frequency
    rule.interval = interval
    rule.unit = unit
    rule.weekdays = sorted(set(weekdays)) or None
    rule.month_day = month_day
    rule.until = as_day(body.get("until"))
    rule.active = bool(body.get("active", True))
    anchor = task.due_date or task.start_date or now()
    rule.next_run_at = next_after(rule, max(anchor, now()) if anchor.tzinfo else now()) if rule.active else None
    session.flush()
    audit.record(
        session, action="UPDATE", resource_type="task", resource_id=task.id,
        resource_label=task.reference, principal=principal,
        after={"recurrence": describe_rule(rule)["summary"]},
        message=f"set {task.reference} to recur: {describe_rule(rule)['summary'].lower()}",
    )
    return {"recurrence": describe_rule(rule)}


def clear_recurrence(session, task_id: Any, *, principal) -> dict[str, Any]:
    from src.models.planning import TaskRecurrence

    principal.require(MANAGE)
    task = _task(session, task_id)
    rule = session.scalars(select(TaskRecurrence).where(TaskRecurrence.task_id == task.id)).first()
    if rule is not None:
        session.delete(rule)
        session.flush()
        audit.record(
            session, action="UPDATE", resource_type="task", resource_id=task.id,
            resource_label=task.reference, principal=principal,
            message=f"{task.reference} no longer recurs",
        )
    return {"recurrence": None}


def occurrence(session, rule, source, when: datetime):
    """One copy of the source task, due on `when`."""
    from src.models.business import Task
    from src.services.records.explorer import resource_for

    resource = resource_for("task")
    first, last = as_day(source.start_date), as_day(source.due_date)
    length = (last - first).days if first and last else 0
    due_day = when.date()
    values = {
        "reference": record_writes._next_identifier(session, resource),
        "title": source.title,
        "description": source.description,
        "status": "NEW",
        "priority": source.priority,
        "kind": source.kind,
        "project_id": source.project_id,
        "organization_id": source.organization_id,
        "assignee_id": source.assignee_id,
        "requester_id": source.requester_id,
        "epic_id": source.epic_id,
        "estimate_hours": source.estimate_hours,
        "story_points": source.story_points,
        "cover_color": source.cover_color,
        "checklist": [
            {"text": item.get("text") or item.get("label") or "", "done": False}
            for item in (source.checklist or []) if isinstance(item, dict)
        ] or None,
        "start_date": at_midnight(due_day - timedelta(days=length)),
        "due_date": at_midnight(due_day),
        "recurrence_id": rule.id,
        "progress": 0,
        "logged_hours": 0,
        "board_position": 0,
        "backlog_rank": 0,
        "metadata_json": {"source": "recurrence", "series": source.reference},
    }
    row = Task(**values)
    session.add(row)
    session.flush()
    audit.record(
        session, action="CREATE", resource_type="task", resource_id=row.id,
        resource_label=row.reference, principal=None,
        after={"title": row.title, "recurs_from": source.reference},
        message=f"created {row.reference}, the next {source.reference}",
    )
    return row


def run_recurrences(session, moment: datetime | None = None) -> dict[str, Any]:
    """Make every occurrence that has come due; move each rule on."""
    from src.models.business import Task
    from src.models.planning import TaskRecurrence

    moment = moment or now()
    rules = session.scalars(
        select(TaskRecurrence).where(
            TaskRecurrence.active.is_(True),
            TaskRecurrence.next_run_at.is_not(None),
            TaskRecurrence.next_run_at <= moment,
        )
    ).all()
    made: list[str] = []
    for rule in rules:
        source = session.scalars(
            select(Task).where(Task.id == rule.task_id, Task.deleted_at.is_(None))
        ).unique().first()
        if source is None:
            rule.active = False
            rule.next_run_at = None
            continue
        count = 0
        while rule.next_run_at is not None and rule.next_run_at <= moment and count < MAX_CATCH_UP:
            row = occurrence(session, rule, source, rule.next_run_at)
            made.append(row.reference)
            rule.occurrences = (rule.occurrences or 0) + 1
            rule.last_run_at = moment
            rule.next_run_at = next_after(rule, rule.next_run_at)
            count += 1
        # Anything still overdue after the cap is skipped, not made later.
        while rule.next_run_at is not None and rule.next_run_at <= moment:
            rule.next_run_at = next_after(rule, rule.next_run_at)
        if rule.next_run_at is None:
            rule.active = False
    session.flush()
    return {"rules": len(rules), "created": made}


# ── the scheduler ────────────────────────────────────────────────────────


def ensure_jobs(session) -> dict[str, Any]:
    """The two scheduled tasks, created on first use (and by the seed)."""
    from src.models.platform import ScheduledTask

    rows = {}
    for code, (name, cron, kind, _period) in JOBS.items():
        row = session.scalars(select(ScheduledTask).where(ScheduledTask.code == code)).first()
        if row is None:
            row = ScheduledTask(
                name=name, code=code, cron=cron, timezone="UTC", job_kind=kind, enabled=True,
                description=f"{name} — work planning (§18). Runs on `{cron}`.",
                next_run_at=now(), run_count=0, failure_count=0,
            )
            session.add(row)
            session.flush()
        rows[code] = row
    return rows


def run_scheduler(session, *, principal=None, codes: tuple[str, ...] | None = None) -> dict[str, Any]:
    """Run the planning jobs now, each recorded as a background job."""
    from src.models.platform import BackgroundJob
    from src.services.work import sprints

    started = now()
    jobs = ensure_jobs(session)
    results: dict[str, Any] = {}
    from src.core import features

    for code, scheduled in jobs.items():
        if codes and code not in codes:
            continue
        if not features.job_allowed(code):
            # Switched off (§27): the job is skipped, not failed, and runs
            # again on its next tick once the flag is back on.
            continue
        name, _cron, kind, period = JOBS[code]
        clock = now()
        if code == "work.recurring-tasks":
            outcome = run_recurrences(session, clock)
            lines = [f"{outcome['rules']} rule(s) due, {len(outcome['created'])} task(s) created"]
            lines += [f"created {reference}" for reference in outcome["created"][:50]]
            units = len(outcome["created"])
        else:
            count = sprints.snapshot_active(session, clock.date())
            outcome = {"sprints": count}
            lines = [f"snapshot written for {count} running sprint(s)"]
            units = count
        finished = now()
        session.add(
            BackgroundJob(
                reference=f"JOB-W{finished.strftime('%y%m%d%H%M%S%f')[:16]}{len(results)}",
                name=name, kind=kind, queue="planning", status="SUCCEEDED", priority="NORMAL",
                progress=100, total_units=units, processed_units=units, failed_units=0,
                attempt=1, max_attempts=1, started_at=clock, finished_at=finished,
                duration_ms=int((finished - clock).total_seconds() * 1000),
                scheduled_for=scheduled.next_run_at or clock,
                initiated_by_id=principal.user_id if principal else None,
                initiated_by_label=(principal.full_name if principal else "Scheduler"),
                scheduled_task_id=scheduled.id, payload={"code": code}, result=outcome,
                log_lines=[{"at": finished.isoformat(), "level": "INFO", "message": line} for line in lines],
            )
        )
        scheduled.last_run_at = clock
        scheduled.last_status = "SUCCEEDED"
        scheduled.last_duration_ms = int((finished - clock).total_seconds() * 1000)
        scheduled.run_count = (scheduled.run_count or 0) + 1
        scheduled.next_run_at = clock + period
        results[code] = outcome
    session.flush()
    return {"ran_at": started.isoformat(), "results": results}


def run_now(session, *, principal) -> dict[str, Any]:
    principal.require(MANAGE)
    return run_scheduler(session, principal=principal)


def catch_up(session) -> bool:
    """Start the jobs off this request if one is overdue. Returns whether it did."""
    from src.config import Config
    from src.core import background
    from src.models.platform import ScheduledTask

    # A test asserts on what it ran; work started behind its back is a race.
    if Config.ENVIRONMENT == "test":
        return False
    ensure_jobs(session)
    overdue = session.scalars(
        select(ScheduledTask.code).where(
            ScheduledTask.code.in_(tuple(JOBS)),
            ScheduledTask.enabled.is_(True),
            ScheduledTask.next_run_at <= now(),
        )
    ).all()
    if not overdue:
        return False
    codes = tuple(overdue)

    def work() -> None:
        from src.core.db import session_scope

        with session_scope() as own:
            run_scheduler(own, codes=codes)

    background.spawn(work, name="work-planning-scheduler")
    return True
