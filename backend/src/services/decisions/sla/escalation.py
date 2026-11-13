"""The sweep: escalating tickets near or past their targets."""

from __future__ import annotations

from sqlalchemy import select

from src.core.clock import now
from src.models.sla import TicketSla
from src.services.decisions.sla.business_hours import CLOSED, MANAGE
from src.services.decisions.sla.clocks import _escalate


def sweep(session, *, principal) -> dict[str, int]:
    """Fire every escalation step that is due, across open tickets."""
    principal.require(MANAGE)
    from src.models.business import Ticket

    moment = now()
    fired = 0
    rows = session.execute(
        select(Ticket, TicketSla).join(TicketSla, TicketSla.ticket_id == Ticket.id)
        .where(Ticket.deleted_at.is_(None), Ticket.status.notin_(CLOSED), TicketSla.policy_id.is_not(None))
    ).unique().all()
    for ticket, state in rows:
        if state.policy is not None:
            fired += len(_escalate(session, ticket, state, state.policy, moment))
    return {"checked": len(rows), "fired": fired}
