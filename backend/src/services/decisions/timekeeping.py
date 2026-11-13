"""Time tracking: timers, entries, the week grid, timesheets and reports.

Four rules the module keeps.

**Minutes are the truth.** A timer, a typed duration, a start and an end and a
cell in the week grid all end as one integer on one row, so every total —
the grid's, the timesheet's, a report's — is the same `SUM`.

**One running timer per person.** Starting a second stops the first: the
database's partial unique index forbids two, and quietly refusing to start is
worse than stopping the other with a note that it was stopped.

**A submitted week is locked.** Entries whose date falls in a SUBMITTED or
APPROVED timesheet cannot be added, edited or removed; a rejection unlocks the
week, and resubmitting raises a fresh approval.

**Your own time is yours; everybody's is `time.approve`.** Reading somebody
else's week, the team view and the reports across people are the approver's.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import func, or_, select

from src.core import audit
from src.core.clock import iso, now
from src.core.errors import ConflictError, NotFoundError, ValidationError
from src.core.pagination import envelope, parse_page, parse_uuid
from src.core.repository import found_or_404, get_or_404
from src.models.timekeeping import TimeEntry, Timesheet
from src.services.decisions import approvals
from src.services.decisions.approvals import Provider

TRACK = "time.track"
APPROVE = "time.approve"

SUBJECT_TYPES = ("task", "ticket", "project")
LOCKED = ("SUBMITTED", "APPROVED")
#: A day longer than this is a timer somebody forgot, not a day of work.
MAX_ENTRY_MINUTES = 16 * 60


# ── Small helpers ───────────────────────────────────────────────────────


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


# ── The timer ───────────────────────────────────────────────────────────


def _running(session, user_id: Any) -> TimeEntry | None:
    return session.scalars(
        select(TimeEntry).where(
            TimeEntry.user_id == user_id, TimeEntry.ended_at.is_(None), TimeEntry.source == "TIMER"
        )
    ).first()


def current(session, *, principal) -> dict[str, Any]:
    principal.require(TRACK)
    running = _running(session, principal.user_id)
    today = now().date()
    minutes_today = session.scalar(
        select(func.coalesce(func.sum(TimeEntry.minutes), 0)).where(
            TimeEntry.user_id == principal.user_id, TimeEntry.work_date == today,
            TimeEntry.ended_at.is_not(None) | (TimeEntry.source != "TIMER"),
        )
    ) or 0
    return {"running": serialize(running) if running else None, "today_minutes": int(minutes_today)}


def _close(entry: TimeEntry, moment: datetime, note: str | None = None) -> None:
    entry.ended_at = moment
    entry.minutes = min(MAX_ENTRY_MINUTES, max(1, round((moment - entry.started_at).total_seconds() / 60)))
    if note:
        entry.note = note


def start(session, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    principal.require(TRACK)
    subject_type = str(payload.get("subject_type") or "")
    info = subject_info(session, subject_type, payload.get("subject_id"))
    moment = now()
    _refuse_if_locked(session, principal.user_id, moment.date())

    stopped = None
    running = _running(session, principal.user_id)
    if running is not None:
        if running.subject_type == subject_type and str(running.subject_id) == str(payload.get("subject_id")):
            return {"running": serialize(running), "stopped": None}
        _close(running, moment)
        stopped = serialize(running)
        session.flush()

    entry = TimeEntry(
        user_id=principal.user_id,
        subject_type=subject_type,
        subject_id=parse_uuid(payload.get("subject_id"), field="subject_id"),
        subject_label=info["label"][:240],
        project_id=info["project_id"],
        customer_id=info["customer_id"],
        work_date=moment.date(),
        started_at=moment,
        minutes=0,
        note=str(payload.get("note") or "").strip() or None,
        billable=bool(payload.get("billable", True)),
        source="TIMER",
    )
    session.add(entry)
    session.flush()
    return {"running": serialize(entry), "stopped": stopped}


def stop(session, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    principal.require(TRACK)
    running = found_or_404(_running(session, principal.user_id), "No timer is running.")
    _close(running, now(), str(payload.get("note") or "").strip() or None)
    if "billable" in payload:
        running.billable = bool(payload.get("billable"))
    session.flush()
    audit.record(session, action="CREATE", resource_type="time_entry", resource_id=running.id,
                 resource_label=running.subject_label or "", principal=principal,
                 after={"minutes": running.minutes}, activity=False,
                 message=f"logged {running.minutes} minutes on {running.subject_label}")
    return {"stopped": serialize(running), "running": None}


# ── Entries ─────────────────────────────────────────────────────────────


def _load(session, ident: Any) -> TimeEntry:
    entry = get_or_404(
        session, TimeEntry, parse_uuid(ident, field="entry_id"), "That time entry does not exist."
    )
    return entry


def _owned(session, ident: Any, principal) -> TimeEntry:
    entry = _load(session, ident)
    if str(entry.user_id) != str(principal.user_id):
        raise NotFoundError("That time entry does not exist.")
    return entry


def listing(session, args, *, principal) -> dict[str, Any]:
    principal.require(TRACK)
    page = parse_page(args, default_sort="work_date")
    clauses = []
    if args.get("user_id") == "all":
        principal.require(APPROVE)
    else:
        clauses.append(TimeEntry.user_id == _person_for(session, principal, args.get("user_id")))
    if args.get("from"):
        clauses.append(TimeEntry.work_date >= _day(args.get("from"), field="from"))
    if args.get("to"):
        clauses.append(TimeEntry.work_date <= _day(args.get("to"), field="to"))
    if args.get("subject_type"):
        clauses.append(TimeEntry.subject_type == str(args.get("subject_type")))
    if args.get("subject_id"):
        clauses.append(TimeEntry.subject_id == parse_uuid(args.get("subject_id"), field="subject_id"))
    if args.get("billable") in ("true", "false"):
        clauses.append(TimeEntry.billable.is_(args.get("billable") == "true"))
    total = session.scalar(select(func.count()).select_from(TimeEntry).where(*clauses)) or 0
    minutes = session.scalar(select(func.coalesce(func.sum(TimeEntry.minutes), 0)).where(*clauses)) or 0
    order = TimeEntry.work_date.asc() if page.order == "asc" else TimeEntry.work_date.desc()
    rows = session.scalars(
        select(TimeEntry).where(*clauses).order_by(order, TimeEntry.started_at.desc().nullslast(),
                                                   TimeEntry.created_at.desc())
        .offset(page.offset).limit(page.page_size)
    ).unique().all()
    moment = now()
    return envelope([serialize(row, moment=moment) for row in rows], int(total), page,
                    total_minutes=int(minutes))


def _apply_times(entry: TimeEntry, payload: dict[str, Any]) -> None:
    has_span = payload.get("started_at") and payload.get("ended_at")
    if has_span:
        started = _moment(payload.get("started_at"), field="started_at")
        ended = _moment(payload.get("ended_at"), field="ended_at")
        if ended <= started:
            raise ValidationError("The end must be after the start.", details={"field": "ended_at"})
        entry.started_at = started
        entry.ended_at = ended
        entry.minutes = _minutes((ended - started).total_seconds() / 60)
        entry.work_date = started.date() if not payload.get("work_date") else _day(payload.get("work_date"))
    elif "minutes" in payload:
        entry.minutes = _minutes(payload.get("minutes"))
        if entry.minutes == 0:
            raise ValidationError("An entry needs some time in it.", details={"field": "minutes"})
        entry.started_at = None if entry.source != "TIMER" else entry.started_at
    if payload.get("work_date") and not has_span:
        entry.work_date = _day(payload.get("work_date"), field="work_date")


def create(session, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    principal.require(TRACK)
    subject_type = str(payload.get("subject_type") or "")
    info = subject_info(session, subject_type, payload.get("subject_id"))
    if not (payload.get("minutes") or (payload.get("started_at") and payload.get("ended_at"))):
        raise ValidationError("Give a duration, or a start and an end.", details={"field": "minutes"})
    entry = TimeEntry(
        user_id=principal.user_id,
        subject_type=subject_type,
        subject_id=parse_uuid(payload.get("subject_id"), field="subject_id"),
        subject_label=info["label"][:240],
        project_id=info["project_id"],
        customer_id=info["customer_id"],
        work_date=_day(payload.get("work_date") or now().date(), field="work_date"),
        note=str(payload.get("note") or "").strip() or None,
        billable=bool(payload.get("billable", True)),
        source="MANUAL",
    )
    _apply_times(entry, payload)
    _refuse_if_locked(session, principal.user_id, entry.work_date)
    session.add(entry)
    session.flush()
    audit.record(session, action="CREATE", resource_type="time_entry", resource_id=entry.id,
                 resource_label=entry.subject_label or "", principal=principal,
                 after={"minutes": entry.minutes, "date": entry.work_date.isoformat()}, activity=False,
                 message=f"logged {entry.minutes} minutes on {entry.subject_label}")
    return serialize(entry)


def update(session, ident: Any, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    principal.require(TRACK)
    entry = _owned(session, ident, principal)
    _refuse_if_locked(session, principal.user_id, entry.work_date)
    if entry.ended_at is None and entry.source == "TIMER":
        raise ConflictError("Stop the timer before editing it.")
    if payload.get("subject_type") or payload.get("subject_id"):
        subject_type = str(payload.get("subject_type") or entry.subject_type)
        info = subject_info(session, subject_type, payload.get("subject_id") or entry.subject_id)
        entry.subject_type = subject_type
        entry.subject_id = parse_uuid(payload.get("subject_id") or entry.subject_id, field="subject_id")
        entry.subject_label = info["label"][:240]
        entry.project_id = info["project_id"]
        entry.customer_id = info["customer_id"]
    _apply_times(entry, payload)
    if "note" in payload:
        entry.note = str(payload.get("note") or "").strip() or None
    if "billable" in payload:
        entry.billable = bool(payload.get("billable"))
    _refuse_if_locked(session, principal.user_id, entry.work_date)
    session.flush()
    return serialize(entry)


def delete(session, ident: Any, *, principal) -> dict[str, Any]:
    principal.require(TRACK)
    entry = _owned(session, ident, principal)
    _refuse_if_locked(session, principal.user_id, entry.work_date)
    session.delete(entry)
    session.flush()
    return {"id": str(ident), "removed": True}


# ── The week ────────────────────────────────────────────────────────────


def _sheet_body(sheet: Timesheet | None, start: date, principal) -> dict[str, Any]:
    if sheet is None:
        return {"id": None, "week_start": start.isoformat(), "status": "DRAFT", "submitted_at": None,
                "decided_at": None, "decision_comment": "", "approval_id": None, "decided_by": None}
    return {
        "id": str(sheet.id),
        "week_start": sheet.week_start.isoformat(),
        "status": sheet.status,
        "submitted_at": iso(sheet.submitted_at),
        "decided_at": iso(sheet.decided_at),
        "decision_comment": sheet.decision_comment or "",
        "approval_id": str(sheet.approval_id) if sheet.approval_id else None,
        "decided_by": None,
        "total_minutes": sheet.total_minutes,
    }


def week(session, args, *, principal) -> dict[str, Any]:
    principal.require(TRACK)
    from src.models.identity import User

    user_id = _person_for(session, principal, args.get("user_id"))
    start = week_start(_day(args.get("week") or now().date(), field="week"))
    days = [start + timedelta(days=offset) for offset in range(7)]
    entries = session.scalars(
        select(TimeEntry).where(
            TimeEntry.user_id == user_id, TimeEntry.work_date >= days[0], TimeEntry.work_date <= days[-1]
        ).order_by(TimeEntry.work_date, TimeEntry.started_at.nullslast(), TimeEntry.created_at)
    ).unique().all()
    moment = now()

    rows: dict[tuple[str, str], dict[str, Any]] = {}
    totals = defaultdict(int)
    billable = 0
    for entry in entries:
        body = serialize(entry, moment=moment)
        key = (entry.subject_type, str(entry.subject_id))
        row = rows.setdefault(key, {
            "subject_type": entry.subject_type, "subject_id": str(entry.subject_id),
            "label": entry.subject_label, "link": _link(entry),
            "cells": {day.isoformat(): 0 for day in days}, "total": 0, "billable_minutes": 0,
            "has_timer_or_manual": {day.isoformat(): 0 for day in days},
        })
        minutes = body["minutes"]
        row["cells"][body["work_date"]] += minutes
        row["total"] += minutes
        if entry.source != "GRID":
            row["has_timer_or_manual"][body["work_date"]] += minutes
        if entry.billable:
            row["billable_minutes"] += minutes
            billable += minutes
        totals[body["work_date"]] += minutes

    sheet = _sheet(session, user_id, start)
    person = session.get(User, user_id)
    locked = sheet is not None and sheet.status in LOCKED
    mine = str(user_id) == str(principal.user_id)
    total = sum(totals.values())
    return {
        "user": {"id": str(user_id), "name": person.full_name if person else ""},
        "week_start": start.isoformat(),
        "previous_week": (start - timedelta(days=7)).isoformat(),
        "next_week": (start + timedelta(days=7)).isoformat(),
        "days": [day.isoformat() for day in days],
        "rows": sorted(
            [{**row, "fixed": row.pop("has_timer_or_manual")} for row in rows.values()],
            key=lambda item: -item["total"],
        ),
        "day_totals": {day.isoformat(): totals.get(day.isoformat(), 0) for day in days},
        "total_minutes": total,
        "billable_minutes": billable,
        "entries": [serialize(entry, moment=moment) for entry in entries],
        "timesheet": _sheet_body(sheet, start, principal),
        "locked": locked,
        "can_edit": mine and not locked,
        "can_submit": mine and not locked and total > 0,
    }


def set_cell(session, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    """Make one cell of the grid add up to what was typed.

    The difference goes into a single GRID entry for that cell. Time a timer or
    a manual entry already put there is left alone — those carry notes and
    start times somebody may need — so a cell cannot be typed below them; the
    answer says so and points at the entries.
    """
    principal.require(TRACK)
    subject_type = str(payload.get("subject_type") or "")
    info = subject_info(session, subject_type, payload.get("subject_id"))
    subject_id = parse_uuid(payload.get("subject_id"), field="subject_id")
    day = _day(payload.get("date"), field="date")
    target = _minutes(payload.get("minutes"))
    _refuse_if_locked(session, principal.user_id, day)

    in_cell = session.scalars(
        select(TimeEntry).where(
            TimeEntry.user_id == principal.user_id, TimeEntry.subject_type == subject_type,
            TimeEntry.subject_id == subject_id, TimeEntry.work_date == day,
        )
    ).all()
    if any(entry.ended_at is None and entry.source == "TIMER" for entry in in_cell):
        raise ConflictError("A timer is running in this cell; stop it first.")
    fixed = sum(entry.minutes for entry in in_cell if entry.source != "GRID")
    grid = [entry for entry in in_cell if entry.source == "GRID"]
    if target < fixed:
        raise ConflictError(
            f"{fixed} minutes here come from timed or typed entries; edit those to go lower.",
            details={"fixed_minutes": fixed},
        )
    wanted = target - fixed
    for extra in grid[1:]:
        session.delete(extra)
    if wanted == 0:
        if grid:
            session.delete(grid[0])
    elif grid:
        grid[0].minutes = wanted
    else:
        session.add(TimeEntry(
            user_id=principal.user_id, subject_type=subject_type, subject_id=subject_id,
            subject_label=info["label"][:240], project_id=info["project_id"],
            customer_id=info["customer_id"], work_date=day, minutes=wanted,
            billable=bool(payload.get("billable", True)), source="GRID",
        ))
    session.flush()
    return week(session, {"week": day.isoformat()}, principal=principal)


# ── Timesheets ──────────────────────────────────────────────────────────


def submit_week(session, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    principal.require(TRACK)
    from src.models.identity import User

    start = week_start(_day(payload.get("week") or now().date(), field="week"))
    end = start + timedelta(days=6)
    totals = session.execute(
        select(func.coalesce(func.sum(TimeEntry.minutes), 0),
               func.coalesce(func.sum(TimeEntry.minutes).filter(TimeEntry.billable.is_(True)), 0))
        .where(TimeEntry.user_id == principal.user_id, TimeEntry.work_date >= start,
               TimeEntry.work_date <= end)
    ).one()
    if not totals[0]:
        raise ValidationError("There is no time in this week to submit.")
    if _running(session, principal.user_id) is not None and start <= now().date() <= end:
        raise ConflictError("Stop the running timer before submitting this week.")
    sheet = _sheet(session, principal.user_id, start)
    if sheet is not None and sheet.status in LOCKED:
        raise ConflictError(f"This week is already {sheet.status.lower()}.")
    if sheet is None:
        sheet = Timesheet(user_id=principal.user_id, week_start=start)
        session.add(sheet)
    sheet.status = "SUBMITTED"
    sheet.total_minutes = int(totals[0])
    sheet.billable_minutes = int(totals[1])
    sheet.submitted_at = now()
    sheet.decided_at = None
    sheet.decided_by_id = None
    sheet.decision_comment = None
    session.flush()

    me = session.get(User, principal.user_id)
    manager_id = me.manager_id if me is not None else None
    if manager_id is not None:
        manager = session.get(User, manager_id)
        if manager is None or manager.role is None or APPROVE not in (manager.role.permissions or []):
            manager_id = None
    hours = sheet.total_minutes / 60
    request = approvals.submit(
        session,
        kind="timesheet",
        requester_id=principal.user_id,
        requester_label=principal.full_name,
        title=f"Timesheet · week of {start.strftime('%d %b %Y')} · {hours:.1f} h",
        summary=str(payload.get("note") or "").strip()
        or f"{hours:.1f} hours, {sheet.billable_minutes / 60:.1f} billable.",
        subject_type="timesheet",
        subject_id=sheet.id,
        subject_label=f"{principal.full_name} · {start.isoformat()}",
        link=f"/time?tab=week&week={start.isoformat()}&user={principal.user_id}",
        payload={"timesheet_id": str(sheet.id), "week_start": start.isoformat(),
                 "total_minutes": sheet.total_minutes, "billable_minutes": sheet.billable_minutes},
        assignee_id=manager_id,
    )
    sheet.approval_id = request.id
    session.flush()
    audit.record(session, action="SUBMIT", resource_type="timesheet", resource_id=sheet.id,
                 resource_label=f"{principal.full_name} {start.isoformat()}", principal=principal,
                 after={"total_minutes": sheet.total_minutes}, message=f"submitted the week of {start.isoformat()}")
    return week(session, {"week": start.isoformat()}, principal=principal)


def _apply_timesheet(session, row, *, approved: bool, principal, comment: str) -> None:
    sheet = get_or_404(
        session,
        Timesheet,
        parse_uuid((row.payload or {}).get("timesheet_id"), field="timesheet_id"),
        "The timesheet no longer exists.",
    )
    sheet.status = "APPROVED" if approved else "REJECTED"
    sheet.decided_at = now()
    sheet.decided_by_id = principal.user_id
    sheet.decision_comment = comment or None


def _withdraw_timesheet(session, row) -> None:
    sheet = session.get(Timesheet, parse_uuid((row.payload or {}).get("timesheet_id"), field="timesheet_id"))
    if sheet is not None and sheet.status == "SUBMITTED":
        sheet.status = "DRAFT"
        sheet.submitted_at = None


def _describe_timesheet(session, row) -> dict[str, Any]:
    payload = row.payload or {}
    start = _day(payload.get("week_start"), field="week_start")
    end = start + timedelta(days=6)
    entries = session.scalars(
        select(TimeEntry).where(TimeEntry.user_id == row.requester_id, TimeEntry.work_date >= start,
                                TimeEntry.work_date <= end)
    ).unique().all()
    per_day = defaultdict(int)
    per_subject: dict[str, int] = defaultdict(int)
    for entry in entries:
        per_day[entry.work_date.isoformat()] += entry.minutes
        per_subject[entry.subject_label or "—"] += entry.minutes
    return {
        "facts": [
            {"label": "Week", "value": f"{start.isoformat()} → {end.isoformat()}"},
            {"label": "Total", "value": f"{payload.get('total_minutes', 0) / 60:.1f} h"},
            {"label": "Billable", "value": f"{payload.get('billable_minutes', 0) / 60:.1f} h"},
        ],
        "days": [{"date": (start + timedelta(days=i)).isoformat(),
                  "minutes": per_day.get((start + timedelta(days=i)).isoformat(), 0)} for i in range(7)],
        "subjects": [{"label": label, "minutes": minutes}
                     for label, minutes in sorted(per_subject.items(), key=lambda item: -item[1])[:8]],
    }


def team(session, args, *, principal) -> dict[str, Any]:
    """Every person's week at a glance, for the approver."""
    principal.require(APPROVE)
    from src.models.identity import User

    start = week_start(_day(args.get("week") or now().date(), field="week"))
    end = start + timedelta(days=6)
    sums = {
        user_id: (int(total), int(bill))
        for user_id, total, bill in session.execute(
            select(TimeEntry.user_id, func.sum(TimeEntry.minutes),
                   func.coalesce(func.sum(TimeEntry.minutes).filter(TimeEntry.billable.is_(True)), 0))
            .where(TimeEntry.work_date >= start, TimeEntry.work_date <= end)
            .group_by(TimeEntry.user_id)
        ).all()
    }
    sheets = {
        sheet.user_id: sheet
        for sheet in session.scalars(select(Timesheet).where(Timesheet.week_start == start)).unique()
    }
    ids = set(sums) | set(sheets)
    people = session.scalars(select(User).where(User.id.in_(ids))).unique().all() if ids else []
    rows = []
    for person in people:
        sheet = sheets.get(person.id)
        total, bill = sums.get(person.id, (0, 0))
        rows.append({
            "user": {"id": str(person.id), "name": person.full_name, "avatar_url": person.avatar_url,
                     "job_title": person.job_title},
            "total_minutes": total, "billable_minutes": bill,
            "status": sheet.status if sheet else "DRAFT",
            "approval_id": str(sheet.approval_id) if sheet and sheet.approval_id else None,
            "submitted_at": iso(sheet.submitted_at) if sheet else None,
        })
    rows.sort(key=lambda item: ({"SUBMITTED": 0, "REJECTED": 1, "DRAFT": 2, "APPROVED": 3}[item["status"]],
                                item["user"]["name"]))
    counts = defaultdict(int)
    for row in rows:
        counts[row["status"]] += 1
    return {"week_start": start.isoformat(), "previous_week": (start - timedelta(days=7)).isoformat(),
            "next_week": (start + timedelta(days=7)).isoformat(), "items": rows, "counts": dict(counts)}


# ── Reports and export ──────────────────────────────────────────────────

GROUPS = ("person", "project", "customer", "subject", "day")


def _report_clauses(session, args, principal) -> list:
    clauses = []
    if not principal.can(APPROVE):
        clauses.append(TimeEntry.user_id == principal.user_id)
    elif args.get("user_id"):
        clauses.append(TimeEntry.user_id == parse_uuid(args.get("user_id"), field="user_id"))
    start = _day(args.get("from"), field="from") if args.get("from") else now().date() - timedelta(days=29)
    end = _day(args.get("to"), field="to") if args.get("to") else now().date()
    if end < start:
        raise ValidationError("The end of the range is before its start.", details={"field": "to"})
    clauses += [TimeEntry.work_date >= start, TimeEntry.work_date <= end,
                or_(TimeEntry.ended_at.is_not(None), TimeEntry.source != "TIMER")]
    if args.get("billable") in ("true", "false"):
        clauses.append(TimeEntry.billable.is_(args.get("billable") == "true"))
    if args.get("project_id"):
        clauses.append(TimeEntry.project_id == parse_uuid(args.get("project_id"), field="project_id"))
    if args.get("customer_id"):
        clauses.append(TimeEntry.customer_id == parse_uuid(args.get("customer_id"), field="customer_id"))
    return clauses


def report(session, args, *, principal) -> dict[str, Any]:
    principal.require(TRACK)
    from src.models.business import Customer, Project
    from src.models.identity import User

    group = str(args.get("group_by") or "person")
    if group not in GROUPS:
        raise ValidationError(f"Cannot group by {group!r}.", details={"allowed": GROUPS})
    clauses = _report_clauses(session, args, principal)
    billable_sum = func.coalesce(func.sum(TimeEntry.minutes).filter(TimeEntry.billable.is_(True)), 0)
    if group == "person":
        statement = (select(User.id, User.full_name, func.sum(TimeEntry.minutes), billable_sum, func.count())
                     .join(User, User.id == TimeEntry.user_id).group_by(User.id, User.full_name))
    elif group == "project":
        statement = (select(Project.id, Project.name, func.sum(TimeEntry.minutes), billable_sum, func.count())
                     .outerjoin(Project, Project.id == TimeEntry.project_id).group_by(Project.id, Project.name))
    elif group == "customer":
        statement = (select(Customer.id, Customer.name, func.sum(TimeEntry.minutes), billable_sum, func.count())
                     .outerjoin(Customer, Customer.id == TimeEntry.customer_id)
                     .group_by(Customer.id, Customer.name))
    elif group == "subject":
        statement = (select(TimeEntry.subject_id, TimeEntry.subject_label, func.sum(TimeEntry.minutes),
                            billable_sum, func.count())
                     .group_by(TimeEntry.subject_id, TimeEntry.subject_label))
    else:
        statement = (select(TimeEntry.work_date, TimeEntry.work_date, func.sum(TimeEntry.minutes),
                            billable_sum, func.count()).group_by(TimeEntry.work_date))
    rows = session.execute(statement.select_from(TimeEntry).where(*clauses)).all()
    items = [
        {"key": str(key) if key is not None else None,
         "label": (value.isoformat() if isinstance(value, date) else value) or "Unassigned",
         "minutes": int(minutes or 0), "billable_minutes": int(bill or 0), "entries": int(count)}
        for key, value, minutes, bill, count in rows
    ]
    items.sort(key=(lambda item: item["label"]) if group == "day" else (lambda item: -item["minutes"]))
    total = sum(item["minutes"] for item in items)
    billable = sum(item["billable_minutes"] for item in items)
    return {"group_by": group, "items": items, "total_minutes": total, "billable_minutes": billable,
            "people": len({item["key"] for item in items}) if group == "person" else None,
            "can_see_everyone": principal.can(APPROVE)}


EXPORT_COLUMNS = (
    ("work_date", "Date"), ("person", "Person"), ("subject_type", "Kind"), ("subject", "Work item"),
    ("project", "Project"), ("customer", "Customer"), ("hours", "Hours"), ("minutes", "Minutes"),
    ("billable", "Billable"), ("note", "Note"), ("source", "Source"), ("timesheet", "Timesheet"),
)


def export(args, *, principal):
    """Time entries as CSV or XLSX, under exactly the report's filters."""
    principal.require(TRACK)
    from src.core import export as writer
    from src.core.db import session_scope
    from src.models.business import Customer, Project
    from src.models.identity import User

    fmt = writer.parse_format(args.get("format"))
    with session_scope() as session:
        clauses = _report_clauses(session, args, principal)
        count = session.scalar(select(func.count()).select_from(TimeEntry).where(*clauses)) or 0
        if count > writer.limit_for(fmt):
            raise ValidationError(f"{count} entries is more than one file holds; narrow the range.",
                                  details={"rows": count, "limit": writer.limit_for(fmt)})
        result = session.execute(
            select(TimeEntry, User.full_name, Project.name, Customer.name)
            .join(User, User.id == TimeEntry.user_id)
            .outerjoin(Project, Project.id == TimeEntry.project_id)
            .outerjoin(Customer, Customer.id == TimeEntry.customer_id)
            .where(*clauses)
            .order_by(TimeEntry.work_date, User.full_name)
        ).unique().all()
        weeks = {(entry.user_id, week_start(entry.work_date)) for entry, *_ in result}
        sheets = {
            (sheet.user_id, sheet.week_start): sheet.status
            for sheet in session.scalars(
                select(Timesheet).where(Timesheet.user_id.in_({user for user, _ in weeks}),
                                        Timesheet.week_start.in_({start for _, start in weeks}))
            ).unique()
        } if weeks else {}
        rows = [
            {"work_date": entry.work_date.isoformat(), "person": person,
             "subject_type": entry.subject_type, "subject": entry.subject_label,
             "project": project or "", "customer": customer or "",
             "hours": round(entry.minutes / 60, 2), "minutes": entry.minutes,
             "billable": "yes" if entry.billable else "no", "note": entry.note or "",
             "source": entry.source.title(),
             "timesheet": sheets.get((entry.user_id, week_start(entry.work_date)), "DRAFT").title()}
            for entry, person, project, customer in result
        ]
    columns = [writer.Column(name, label) for name, label in EXPORT_COLUMNS]
    return writer.response(iter(rows), columns, fmt=fmt, stem="time-entries")


def subjects(session, args, *, principal) -> dict[str, Any]:
    """What time can be booked against: my recent subjects, or a search."""
    principal.require(TRACK)
    from src.models.business import Project, Task, Ticket

    q = str(args.get("q") or "").strip()
    items: list[dict[str, Any]] = []
    if not q:
        recent = session.execute(
            select(TimeEntry.subject_type, TimeEntry.subject_id, TimeEntry.subject_label,
                   func.max(TimeEntry.created_at).label("last"))
            .where(TimeEntry.user_id == principal.user_id)
            .group_by(TimeEntry.subject_type, TimeEntry.subject_id, TimeEntry.subject_label)
            .order_by(func.max(TimeEntry.created_at).desc()).limit(8)
        ).all()
        items = [{"subject_type": kind, "subject_id": str(ident), "label": label, "recent": True}
                 for kind, ident, label, _last in recent]
        mine = session.scalars(
            select(Task).where(Task.assignee_id == principal.user_id, Task.deleted_at.is_(None),
                               Task.status.notin_(("DONE", "CANCELLED")))
            .order_by(Task.updated_at.desc()).limit(6)
        ).unique().all()
        seen = {item["subject_id"] for item in items}
        items += [{"subject_type": "task", "subject_id": str(task.id),
                   "label": f"{task.reference} · {task.title}", "recent": False}
                  for task in mine if str(task.id) not in seen]
        return {"items": items}
    like = f"%{q}%"
    for kind, model, label_cols in (("task", Task, (Task.reference, Task.title)),
                                    ("ticket", Ticket, (Ticket.reference, Ticket.subject)),
                                    ("project", Project, (Project.code, Project.name))):
        rows = session.scalars(
            select(model).where(model.deleted_at.is_(None), or_(*(col.ilike(like) for col in label_cols)))
            .order_by(model.updated_at.desc()).limit(6)
        ).unique().all()
        for row in rows:
            first, second = (getattr(row, col.key) for col in label_cols)
            items.append({"subject_type": kind, "subject_id": str(row.id), "label": f"{first} · {second}",
                          "recent": False})
    return {"items": items}


def on_subject(session, args, *, principal) -> dict[str, Any]:
    """The time on one task or ticket: total, mine, and the latest entries."""
    principal.require(TRACK)
    subject_type = str(args.get("subject_type") or "")
    subject_id = parse_uuid(args.get("subject_id"), field="subject_id")
    clauses = [TimeEntry.subject_type == subject_type, TimeEntry.subject_id == subject_id]
    if not principal.can(APPROVE):
        clauses.append(TimeEntry.user_id == principal.user_id)
    total = session.scalar(select(func.coalesce(func.sum(TimeEntry.minutes), 0)).where(*clauses)) or 0
    mine = session.scalar(select(func.coalesce(func.sum(TimeEntry.minutes), 0)).where(
        *clauses, TimeEntry.user_id == principal.user_id)) or 0
    latest = session.scalars(select(TimeEntry).where(*clauses)
                             .order_by(TimeEntry.work_date.desc(), TimeEntry.ended_at.desc().nullsfirst(),
                                       TimeEntry.created_at.desc()).limit(5)).unique().all()
    return {"total_minutes": int(total), "my_minutes": int(mine),
            "entries": [serialize(entry) for entry in latest]}


approvals.register(Provider(
    kind="timesheet", label="Timesheets", icon="clock", decide_permission=APPROVE, sla_hours=48,
    apply=_apply_timesheet, describe=_describe_timesheet,
    extra={"on_withdraw": _withdraw_timesheet},
))

