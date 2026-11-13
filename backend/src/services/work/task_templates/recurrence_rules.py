"""Recurrence rules: the next date, a description, setting and clearing them."""

from __future__ import annotations

import calendar
from datetime import date, datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select

from src.core import audit
from src.core.clock import now
from src.core.errors import ValidationError
from src.services.work.sprints import MANAGE, READ
from src.services.work.task_templates.template_store import (
    FREQUENCIES,
    UNITS,
    WEEKDAY_NAMES,
)
from src.services.work.timeline import _task, as_day


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
