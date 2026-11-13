"""Which policy a ticket falls under, and its SLA clock."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import select

from src.core import audit, vocabulary
from src.core.clock import now
from src.core.pagination import parse_uuid
from src.models.sla import SlaPolicy, TicketSla
from src.services.decisions.sla.business_hours import (
    CLOSED,
    add_business_minutes,
    business_minutes_between,
)


def _policies(session) -> list[SlaPolicy]:
    return list(session.scalars(
        select(SlaPolicy).where(SlaPolicy.deleted_at.is_(None))
        .order_by(SlaPolicy.position, SlaPolicy.created_at)
    ).unique())


def matches(policy: SlaPolicy, ticket, customer) -> bool:
    conditions = policy.conditions or {}
    if conditions.get("customer_ids") and str(ticket.customer_id) not in {
        str(item) for item in conditions["customer_ids"]
    }:
        return False
    if conditions.get("segments") and (customer is None or customer.segment not in conditions["segments"]):
        return False
    if conditions.get("categories") and ticket.category not in conditions["categories"]:
        return False
    if conditions.get("channels") and ticket.channel not in conditions["channels"]:
        return False
    return True


def policy_for(session, ticket, *, policies: list[SlaPolicy] | None = None) -> SlaPolicy | None:
    customer = ticket.customer if ticket.customer_id else None
    for policy in policies if policies is not None else _policies(session):
        if policy.active and matches(policy, ticket, customer):
            return policy
    return None


def _target(policy: SlaPolicy | None, priority: str) -> dict[str, int]:
    if policy is None:
        return {}
    raw = (policy.targets or {}).get(priority) or {}
    return {key: int(raw[key]) for key in ("first_response", "resolution") if raw.get(key)}


def _state(session, ticket) -> TicketSla:
    state = session.scalars(select(TicketSla).where(TicketSla.ticket_id == ticket.id)).first()
    if state is None:
        state = TicketSla(ticket_id=ticket.id, paused_minutes=0, escalations_fired=[])
        session.add(state)
    return state


def compute(session, ticket, *, moment: datetime | None = None, policies=None, sweep: bool = True) -> TicketSla:
    """Recompute one ticket's clock, and write its deadline and breach flag."""
    moment = moment or now()
    state = _state(session, ticket)
    policy = policy_for(session, ticket, policies=policies)
    if state.policy_id != (policy.id if policy else None):
        state.escalations_fired = []
    state.policy_id = policy.id if policy else None
    state.policy = policy
    calendar = policy.calendar if policy else None

    paused_statuses = set((policy.pause_statuses if policy else None) or [])
    if ticket.status in paused_statuses and ticket.status not in CLOSED:
        if state.paused_since is None:
            state.paused_since = moment
    elif state.paused_since is not None:
        state.paused_minutes = (state.paused_minutes or 0) + max(
            0, business_minutes_between(calendar, state.paused_since, moment))
        state.paused_since = None

    target = _target(policy, ticket.priority)
    created = clock_start(ticket, policy, moment)
    state.first_response_due_at = (
        add_business_minutes(calendar, created, target["first_response"])
        if "first_response" in target else None
    )
    if "resolution" in target:
        state.resolution_due_at = add_business_minutes(
            calendar, created, target["resolution"] + (state.paused_minutes or 0))
    else:
        state.resolution_due_at = None
    state.computed_at = moment

    if policy is not None:
        ticket.due_at = state.resolution_due_at
        finished = ticket.resolved_at if ticket.status in CLOSED and ticket.resolved_at else None
        if state.resolution_due_at is None:
            ticket.sla_breached = False
        elif state.paused_since is not None:
            ticket.sla_breached = state.paused_since > state.resolution_due_at
        else:
            ticket.sla_breached = (finished or moment) > state.resolution_due_at
    session.flush()
    if sweep and policy is not None and ticket.status not in CLOSED:
        _escalate(session, ticket, state, policy, moment)
    return state


def clock_start(ticket, policy: SlaPolicy | None, moment: datetime | None = None) -> datetime:
    """When the clock started: the ticket's arrival, or the policy's, if later.

    A policy is a promise made from the day it exists. Measuring a ticket
    raised a quarter ago against a target written this morning would report
    every old ticket as breached on the day the policy was introduced, which
    is a statement about the policy rather than about the service.
    """
    created = ticket.created_at or moment or now()
    since = getattr(policy, "created_at", None) if policy is not None else None
    return max(created, since) if since else created


def _percent(state: TicketSla, policy: SlaPolicy, ticket, moment: datetime) -> float | None:
    target = _target(policy, ticket.priority).get("resolution")
    if not target:
        return None
    spent = business_minutes_between(policy.calendar, clock_start(ticket, policy, moment), moment) - (state.paused_minutes or 0)
    if state.paused_since is not None:
        spent -= business_minutes_between(policy.calendar, state.paused_since, moment)
    return max(0.0, spent * 100.0 / target)


def _escalate(session, ticket, state: TicketSla, policy: SlaPolicy, moment: datetime) -> list[int]:
    from src.models.identity import User
    from src.services.collaboration import notifications

    percent = _percent(state, policy, ticket, moment)
    if percent is None:
        return []
    fired = set(state.escalations_fired or [])
    newly = []
    for index, step in enumerate(policy.escalations or []):
        if index in fired or percent < float(step.get("at_percent") or 0):
            continue
        action = step.get("action")
        target_user = None
        if step.get("target") == "assignee":
            target_user = ticket.assignee_id
        elif step.get("target") == "manager" and ticket.assignee_id:
            assignee = session.get(User, ticket.assignee_id)
            target_user = assignee.manager_id if assignee else None
        elif step.get("user_id"):
            target_user = parse_uuid(step.get("user_id"), field="user_id")
        if action == "NOTIFY" and target_user:
            notifications.publish(
                session, user_id=target_user,
                title=f"{ticket.reference} is at {int(step.get('at_percent'))}% of its SLA",
                category="ALERT", severity="CRITICAL" if percent >= 100 else "WARNING",
                body=f"{policy.name}: {ticket.subject}", link=f"/tickets/{ticket.id}",
                icon="alert-triangle", resource_type="ticket", resource_id=str(ticket.id),
                group_key=f"sla:{ticket.id}",
            )
        elif action == "ASSIGN" and target_user:
            ticket.assignee_id = target_user
        elif action == "RAISE_PRIORITY":
            order = list(vocabulary.PRIORITY)
            if ticket.priority in order and order.index(ticket.priority) < len(order) - 1:
                ticket.priority = order[order.index(ticket.priority) + 1]
        newly.append(index)
        audit.record(session, action="ESCALATE", resource_type="ticket", resource_id=ticket.id,
                     resource_label=ticket.reference, principal=None,
                     after={"step": index, "action": action, "percent": round(percent)},
                     message=f"SLA escalation: {action.lower().replace('_', ' ')} at {round(percent)}%",
                     activity=False)
    if newly:
        state.escalations_fired = sorted(fired | set(newly))
        session.flush()
    return newly
