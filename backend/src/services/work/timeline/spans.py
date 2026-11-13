"""Timeline vocabulary: day boundaries, spans, dependency violations."""

from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from typing import Any

from src.core.clock import now
from src.core.errors import ValidationError

#: The most bars one timeline draws. A Gantt chart of two thousand rows is a
#: texture, not a plan; the reader narrows by project instead.
MAX_BARS = 400


GROUPINGS = ("project", "epic", "assignee")


CLOSED = ("DONE", "CANCELLED")


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
