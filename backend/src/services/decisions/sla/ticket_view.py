"""A ticket's SLA as its page shows it."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import select

from src.core.clock import iso, now
from src.core.pagination import parse_uuid
from src.core.repository import get_or_404
from src.models.sla import TicketSla
from src.services.decisions.sla.business_hours import (
    CLOSED,
    business_minutes_between,
    is_open_now,
)
from src.services.decisions.sla.clocks import _percent, _target, compute


def _clock(calendar, due: datetime | None, done: datetime | None, moment: datetime,
           paused: bool) -> dict[str, Any] | None:
    if due is None:
        return None
    reference = done or moment
    return {
        "due_at": iso(due),
        "met": done is not None and done <= due,
        "breached": reference > due and not (paused and done is None),
        "done_at": iso(done),
        "business_minutes_left": None if done else business_minutes_between(calendar, moment, due),
    }


def for_ticket(session, ticket_id: Any, *, principal) -> dict[str, Any]:
    principal.require("records.view")
    from src.models.business import Ticket

    ticket = get_or_404(
        session,
        Ticket,
        parse_uuid(ticket_id, field="ticket_id"),
        "That ticket does not exist.",
        live=True,
    )
    state = session.scalars(select(TicketSla).where(TicketSla.ticket_id == ticket.id)).first()
    if state is None:
        state = compute(session, ticket, sweep=False)
    policy = state.policy
    calendar = policy.calendar if policy else None
    moment = now()
    paused = state.paused_since is not None
    target = _target(policy, ticket.priority)
    finished = ticket.resolved_at if ticket.status in CLOSED else None
    return {
        "ticket_id": str(ticket.id),
        "policy": None if policy is None else {"id": str(policy.id), "name": policy.name,
                                               "description": policy.description or ""},
        "calendar": None if calendar is None else {"id": str(calendar.id), "name": calendar.name,
                                                   "timezone": calendar.timezone},
        "priority": ticket.priority,
        "targets": target,
        "first_response": _clock(calendar, state.first_response_due_at, ticket.first_response_at,
                                 moment, False),
        "resolution": _clock(calendar, state.resolution_due_at, finished, moment, paused),
        "paused": paused,
        "paused_since": iso(state.paused_since),
        "paused_minutes": state.paused_minutes or 0,
        "pause_statuses": list((policy.pause_statuses if policy else None) or []),
        "percent_elapsed": None if policy is None or finished else (
            None if (pct := _percent(state, policy, ticket, moment)) is None else round(pct, 1)),
        "in_business_hours": is_open_now(calendar, moment),
        "escalations": [
            {**step, "fired": index in set(state.escalations_fired or [])}
            for index, step in enumerate((policy.escalations if policy else None) or [])
        ],
        "computed_at": iso(state.computed_at),
    }
