"""The running timer: start, stop, the current one."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import func, select

from src.core import audit
from src.core.clock import now
from src.core.pagination import parse_uuid
from src.core.repository import found_or_404
from src.models.timekeeping import TimeEntry
from src.services.decisions.timekeeping.common import (
    MAX_ENTRY_MINUTES,
    TRACK,
    _refuse_if_locked,
    serialize,
    subject_info,
)


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
