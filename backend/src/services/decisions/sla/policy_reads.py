"""Policies and calendars as the admin page reads them."""

from __future__ import annotations

from typing import Any
from zoneinfo import available_timezones

from sqlalchemy import func, select

from src.core import vocabulary
from src.core.clock import iso
from src.core.pagination import parse_uuid
from src.core.repository import get_or_404
from src.models.sla import BusinessCalendar, SlaPolicy, TicketSla
from src.services.decisions.sla.business_hours import (
    ACTIONS,
    CLOSED,
    DAYS,
    MANAGE,
    NOTIFY_TARGETS,
    _parse_hm,
)
from src.services.decisions.sla.clocks import _policies


def _calendar_body(row: BusinessCalendar, *, used_by: int = 0) -> dict[str, Any]:
    hours = row.hours or {}
    weekly = 0
    for day in DAYS:
        for pair in hours.get(day, []) or []:
            start, end = _parse_hm(pair[0]), _parse_hm(pair[1])
            close = end.hour * 60 + end.minute or 24 * 60
            weekly += close - (start.hour * 60 + start.minute)
    return {"id": str(row.id), "name": row.name, "timezone": row.timezone, "hours": hours,
            "holidays": row.holidays or [], "is_default": row.is_default,
            "weekly_minutes": weekly, "used_by": used_by, "updated_at": iso(row.updated_at)}


def _policy_body(row: SlaPolicy, *, covered: int = 0, breached: int = 0) -> dict[str, Any]:
    return {
        "id": str(row.id), "name": row.name, "description": row.description or "",
        "position": row.position, "active": row.active, "conditions": row.conditions or {},
        "targets": row.targets or {}, "calendar_id": str(row.calendar_id) if row.calendar_id else None,
        "calendar_name": row.calendar.name if row.calendar else None,
        "pause_statuses": row.pause_statuses or [], "escalations": row.escalations or [],
        "covered_open": covered, "breached_open": breached, "updated_at": iso(row.updated_at),
    }


def catalogue(session, *, principal) -> dict[str, Any]:
    principal.require("records.view")
    from src.models.business import Customer

    customers = session.execute(
        select(Customer.id, Customer.name, Customer.segment).where(Customer.deleted_at.is_(None))
        .order_by(Customer.name).limit(500)
    ).all()
    zones = sorted(z for z in available_timezones() if "/" in z and not z.startswith(("Etc/", "SystemV")))
    return {
        "priorities": list(vocabulary.PRIORITY),
        "categories": list(vocabulary.TICKET_CATEGORY),
        "channels": list(vocabulary.TICKET_CHANNEL),
        "segments": list(vocabulary.CUSTOMER_SEGMENT),
        "statuses": list(vocabulary.TICKET_STATUS),
        "actions": list(ACTIONS),
        "notify_targets": list(NOTIFY_TARGETS),
        "days": list(DAYS),
        "timezones": ["UTC", *zones],
        "customers": [{"id": str(ident), "name": name, "segment": segment} for ident, name, segment in customers],
        "can_manage": principal.can(MANAGE),
    }


def policies(session, *, principal) -> dict[str, Any]:
    principal.require("records.view")
    from src.models.business import Ticket

    counts = {
        policy_id: (int(total), int(late))
        for policy_id, total, late in session.execute(
            select(TicketSla.policy_id, func.count(),
                   func.count().filter(Ticket.sla_breached.is_(True)))
            .join(Ticket, Ticket.id == TicketSla.ticket_id)
            .where(Ticket.deleted_at.is_(None), Ticket.status.notin_(CLOSED))
            .group_by(TicketSla.policy_id)
        ).all()
    }
    rows = _policies(session)
    calendars = session.scalars(
        select(BusinessCalendar).where(BusinessCalendar.deleted_at.is_(None)).order_by(BusinessCalendar.name)
    ).all()
    uses = {}
    for row in rows:
        if row.calendar_id:
            uses[row.calendar_id] = uses.get(row.calendar_id, 0) + 1
    uncovered = counts.get(None, (0, 0))[0]
    return {
        "items": [_policy_body(row, covered=counts.get(row.id, (0, 0))[0],
                               breached=counts.get(row.id, (0, 0))[1]) for row in rows],
        "calendars": [_calendar_body(cal, used_by=uses.get(cal.id, 0)) for cal in calendars],
        "uncovered_open": uncovered,
        "can_manage": principal.can(MANAGE),
    }


def policy(session, ident: Any, *, principal) -> dict[str, Any]:
    principal.require("records.view")
    row = _policy_row(session, ident)
    return _policy_body(row)


def _policy_row(session, ident: Any) -> SlaPolicy:
    row = get_or_404(
        session,
        SlaPolicy,
        parse_uuid(ident, field="policy_id"),
        "That SLA policy does not exist.",
        live=True,
    )
    return row


def _calendar_row(session, ident: Any) -> BusinessCalendar:
    row = get_or_404(
        session,
        BusinessCalendar,
        parse_uuid(ident, field="calendar_id"),
        "That calendar does not exist.",
        live=True,
    )
    return row
