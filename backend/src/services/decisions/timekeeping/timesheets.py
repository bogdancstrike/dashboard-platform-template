"""Submitting a week for approval, and the team's timesheets."""

from __future__ import annotations

from collections import defaultdict
from datetime import timedelta
from typing import Any

from sqlalchemy import func, select

from src.core import audit
from src.core.clock import iso, now
from src.core.errors import ConflictError, ValidationError
from src.core.pagination import parse_uuid
from src.core.repository import get_or_404
from src.models.timekeeping import TimeEntry, Timesheet
from src.services.decisions import approvals
from src.services.decisions.approvals import Provider
from src.services.decisions.timekeeping.common import (
    APPROVE,
    LOCKED,
    TRACK,
    _day,
    _sheet,
    week_start,
)
from src.services.decisions.timekeeping.timer import _running
from src.services.decisions.timekeeping.weekly import week


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


approvals.register(Provider(
    kind="timesheet", label="Timesheets", icon="clock", decide_permission=APPROVE, sla_hours=48,
    apply=_apply_timesheet, describe=_describe_timesheet,
    extra={"on_withdraw": _withdraw_timesheet},
))
