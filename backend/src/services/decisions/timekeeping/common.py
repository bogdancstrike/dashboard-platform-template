"""Permissions, limits and the helpers every time view shares: days, people, subjects, locks."""

from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import select

from src.core.clock import iso, now
from src.core.errors import ConflictError, ValidationError
from src.core.pagination import parse_uuid
from src.models.timekeeping import TimeEntry, Timesheet

TRACK = "time.track"


APPROVE = "time.approve"


SUBJECT_TYPES = ("task", "ticket", "project")


LOCKED = ("SUBMITTED", "APPROVED")


#: A day longer than this is a timer somebody forgot, not a day of work.
MAX_ENTRY_MINUTES = 16 * 60


def week_start(day: date) -> date:
    return day - timedelta(days=day.weekday())


def _day(value: Any, *, field: str = "date") -> date:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value)[:10])
    except (TypeError, ValueError) as exc:
        raise ValidationError(f"{field} must be a date (YYYY-MM-DD).", details={"field": field}) from exc


def _moment(value: Any, *, field: str) -> datetime:
    from src.core.clock import parse

    try:
        parsed = parse(str(value)) if value else None
    except (TypeError, ValueError):
        parsed = None
    if parsed is None:
        raise ValidationError(f"{field} must be a date and time.", details={"field": field})
    return parsed


def _minutes(value: Any, *, field: str = "minutes") -> int:
    try:
        minutes = int(round(float(value)))
    except (TypeError, ValueError) as exc:
        raise ValidationError(f"{field} must be a number of minutes.", details={"field": field}) from exc
    if minutes < 0 or minutes > MAX_ENTRY_MINUTES:
        raise ValidationError(
            f"{field} must be between 0 and {MAX_ENTRY_MINUTES} minutes.", details={"field": field}
        )
    return minutes


def _person_for(session, principal, user_id: Any) -> UUID:
    """Whose time a request is about — mine unless I may read others'."""
    if not user_id or str(user_id) == str(principal.user_id):
        return principal.user_id
    if not principal.can(APPROVE):
        principal.require(APPROVE)
    return parse_uuid(user_id, field="user_id")


def subject_info(session, subject_type: str, subject_id: Any) -> dict[str, Any]:
    """Label, link, project and customer of what time is booked against."""
    from src.models.business import Project, Task, Ticket

    if subject_type not in SUBJECT_TYPES:
        raise ValidationError(
            f"Time is booked against a task, a ticket or a project, not {subject_type!r}.",
            details={"field": "subject_type", "allowed": SUBJECT_TYPES},
        )
    ident = parse_uuid(subject_id, field="subject_id")
    model = {"task": Task, "ticket": Ticket, "project": Project}[subject_type]
    row = session.get(model, ident)
    if row is None or getattr(row, "deleted_at", None) is not None:
        raise ValidationError(f"That {subject_type} does not exist.", details={"field": "subject_id"})
    if subject_type == "task":
        project = session.get(Project, row.project_id) if row.project_id else None
        return {"label": f"{row.reference} · {row.title}", "project_id": row.project_id,
                "customer_id": project.customer_id if project else None, "link": f"/tasks/{row.id}",
                "project_label": project.name if project else None}
    if subject_type == "ticket":
        project = session.get(Project, row.project_id) if row.project_id else None
        return {"label": f"{row.reference} · {row.subject}", "project_id": row.project_id,
                "customer_id": row.customer_id, "link": f"/tickets/{row.id}",
                "project_label": project.name if project else None}
    return {"label": f"{row.code} · {row.name}", "project_id": row.id,
            "customer_id": row.customer_id, "link": f"/projects/{row.id}", "project_label": row.name}


def _link(entry: TimeEntry) -> str | None:
    if not entry.subject_id:
        return None
    return {"task": "/tasks/", "ticket": "/tickets/", "project": "/projects/"}.get(
        entry.subject_type, "/"
    ) + str(entry.subject_id)


def _sheet(session, user_id: Any, start: date) -> Timesheet | None:
    return session.scalars(
        select(Timesheet).where(Timesheet.user_id == user_id, Timesheet.week_start == start)
    ).first()


def _refuse_if_locked(session, user_id: Any, day: date) -> None:
    sheet = _sheet(session, user_id, week_start(day))
    if sheet is not None and sheet.status in LOCKED:
        raise ConflictError(
            f"The week of {sheet.week_start.isoformat()} is {sheet.status.lower()} and locked.",
            details={"week": sheet.week_start.isoformat(), "status": sheet.status},
        )


def serialize(entry: TimeEntry, *, moment=None) -> dict[str, Any]:
    moment = moment or now()
    running = entry.ended_at is None and entry.source == "TIMER"
    elapsed = int((moment - entry.started_at).total_seconds()) if running and entry.started_at else None
    return {
        "id": str(entry.id),
        "user_id": str(entry.user_id),
        "user_name": entry.user.full_name if entry.user else None,
        "subject_type": entry.subject_type,
        "subject_id": str(entry.subject_id) if entry.subject_id else None,
        "subject_label": entry.subject_label,
        "link": _link(entry),
        "project_id": str(entry.project_id) if entry.project_id else None,
        "customer_id": str(entry.customer_id) if entry.customer_id else None,
        "work_date": entry.work_date.isoformat() if entry.work_date else None,
        "started_at": iso(entry.started_at),
        "ended_at": iso(entry.ended_at),
        "minutes": entry.minutes if not running else max(0, (elapsed or 0) // 60),
        "elapsed_seconds": elapsed,
        "running": running,
        "note": entry.note or "",
        "billable": entry.billable,
        "source": entry.source,
    }
