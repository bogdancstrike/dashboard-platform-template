"""Time entries: list, create, change, delete."""

from __future__ import annotations

from typing import Any

from sqlalchemy import func, select

from src.core import audit
from src.core.clock import now
from src.core.errors import ConflictError, NotFoundError, ValidationError
from src.core.pagination import envelope, parse_page, parse_uuid
from src.core.repository import get_or_404
from src.models.timekeeping import TimeEntry
from src.services.decisions.timekeeping.common import (
    APPROVE,
    TRACK,
    _day,
    _minutes,
    _moment,
    _person_for,
    _refuse_if_locked,
    serialize,
    subject_info,
)


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
