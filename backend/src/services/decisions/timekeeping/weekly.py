"""The week grid, and setting one cell of it."""

from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta
from typing import Any

from sqlalchemy import select

from src.core.clock import iso, now
from src.core.errors import ConflictError
from src.core.pagination import parse_uuid
from src.models.timekeeping import TimeEntry, Timesheet
from src.services.decisions.timekeeping.common import (
    LOCKED,
    TRACK,
    _day,
    _link,
    _minutes,
    _person_for,
    _refuse_if_locked,
    _sheet,
    serialize,
    subject_info,
    week_start,
)


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
