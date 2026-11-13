"""Keeping SLA clocks current: on every ticket write, and all at once."""

from __future__ import annotations

from sqlalchemy import select

from src.core.clock import now
from src.services.decisions.sla.business_hours import CLOSED
from src.services.decisions.sla.clocks import _policies, compute
from src.services.records import writes as record_writes

#: Changes that move a ticket's clock.
CLOCK_FIELDS = {"status", "priority", "customer_id", "category", "channel", "resolved_at",
                "first_response_at", "subject"}


@record_writes.derived.connect
def _on_record_write(session, resource, row, changed: set[str]) -> None:
    if resource.key == "ticket":
        on_ticket_write(session, row, changed)


def on_ticket_write(session, ticket, changed: set[str]) -> None:
    """The record-write hook: a new ticket, or one whose clock inputs moved."""
    if changed & CLOCK_FIELDS:
        compute(session, ticket)


def recompute_all(session, *, only_open: bool = False) -> dict[str, int]:
    from src.models.business import Ticket

    policies = _policies(session)
    clauses = [Ticket.deleted_at.is_(None)]
    if only_open:
        clauses.append(Ticket.status.notin_(CLOSED))
    tickets = session.scalars(select(Ticket).where(*clauses)).unique().all()
    moment = now()
    covered = 0
    for ticket in tickets:
        state = compute(session, ticket, moment=moment, policies=policies, sweep=False)
        covered += 1 if state.policy_id else 0
    return {"tickets": len(tickets), "covered": covered}
