"""Seed data for decisions: populate_sla."""

from __future__ import annotations

from datetime import timedelta

from sqlalchemy import func, select

from src.core.clock import now
from src.seed.decisions.time_entries import _holidays


def populate_sla(session) -> dict[str, int]:
    from src.models.sla import BusinessCalendar, SlaPolicy, TicketSla
    from src.services.decisions import sla

    if session.scalar(select(func.count()).select_from(SlaPolicy).where(SlaPolicy.deleted_at.is_(None))):
        return {"calendars": 0, "policies": 0, "tickets": 0}
    weekdays = ("mon", "tue", "wed", "thu", "fri")
    office = BusinessCalendar(name="Berlin office hours", timezone="Europe/Berlin",
                              hours={**{d: [["09:00", "12:30"], ["13:30", "18:00"]] for d in weekdays},
                                     "sat": [], "sun": []},
                              holidays=_holidays(now().date()), is_default=True)
    follow = BusinessCalendar(name="Follow the sun (24×5)", timezone="UTC",
                              hours={**{d: [["00:00", "00:00"]] for d in weekdays}, "sat": [], "sun": []},
                              holidays=[], is_default=False)
    always = BusinessCalendar(name="Around the clock", timezone="UTC",
                              hours={d: [["00:00", "00:00"]] for d in (*weekdays, "sat", "sun")},
                              holidays=[], is_default=False)
    session.add_all([office, follow, always])
    session.flush()
    steps = [{"at_percent": 75, "action": "NOTIFY", "target": "assignee"},
             {"at_percent": 100, "action": "NOTIFY", "target": "manager"},
             {"at_percent": 150, "action": "RAISE_PRIORITY"}]
    policies = [
        SlaPolicy(name="Strategic accounts — premium", position=1, active=True,
                  description="Our largest customers get round-the-clock cover and the fastest answers.",
                  conditions={"segments": ["STRATEGIC", "ENTERPRISE"]}, calendar_id=always.id,
                  targets={"CRITICAL": {"first_response": 15, "resolution": 240},
                           "HIGH": {"first_response": 60, "resolution": 480},
                           "NORMAL": {"first_response": 120, "resolution": 1440},
                           "LOW": {"first_response": 240, "resolution": 2880}},
                  pause_statuses=["WAITING_CUSTOMER"], escalations=steps),
        SlaPolicy(name="Billing and access", position=2, active=True,
                  description="Money and sign-in problems block people from working; answered within the day.",
                  conditions={"categories": ["BILLING", "ACCESS"]}, calendar_id=follow.id,
                  targets={"CRITICAL": {"first_response": 30, "resolution": 480},
                           "HIGH": {"first_response": 120, "resolution": 960},
                           "NORMAL": {"first_response": 240, "resolution": 1920},
                           "LOW": {"first_response": 480, "resolution": 2880}},
                  pause_statuses=["WAITING_CUSTOMER"], escalations=steps[:2]),
        SlaPolicy(name="Standard support", position=3, active=True,
                  description="Everything else, in office hours.", conditions={}, calendar_id=office.id,
                  targets={"CRITICAL": {"first_response": 60, "resolution": 960},
                           "HIGH": {"first_response": 240, "resolution": 1920},
                           "NORMAL": {"first_response": 480, "resolution": 4800},
                           "LOW": {"first_response": 960, "resolution": 9600}},
                  pause_statuses=["WAITING_CUSTOMER"], escalations=steps[:2]),
    ]
    # In force for a while already, so the demo shows a desk with a history:
    # some tickets met, some at risk, some late — rather than every ticket
    # raised before today counted against a promise made today.
    for offset, policy in zip((12, 9, 6), policies):
        policy.created_at = now() - timedelta(days=offset)
    session.add_all(policies)
    session.flush()
    result = sla.recompute_all(session)
    # The seed must not fire a backlog of escalations at the demo's people the
    # first time somebody presses "Apply": every step already passed counts as
    # having fired.
    moment = now()
    for state in session.scalars(select(TicketSla).where(TicketSla.policy_id.is_not(None))).unique():
        from src.models.business import Ticket

        ticket = session.get(Ticket, state.ticket_id)
        percent = sla._percent(state, state.policy, ticket, moment) if ticket else None
        if percent is None:
            continue
        state.escalations_fired = [index for index, step in enumerate(state.policy.escalations or [])
                                   if percent >= step["at_percent"]]
    session.flush()
    return {"calendars": 3, "policies": len(policies), "tickets": result["tickets"]}


SUPPORT_FIELDS = [
    {"id": "who", "type": "heading", "label": "About you"},
    {"id": "name", "type": "text", "label": "Your name", "required": True},
    {"id": "email", "type": "email", "label": "Work email", "required": True,
     "help": "We reply here."},
    {"id": "problem", "type": "heading", "label": "The problem"},
    {"id": "subject", "type": "text", "label": "What is going wrong?", "required": True, "map_to": "subject",
     "placeholder": "Invoices download as empty PDFs"},
    {"id": "area", "type": "select", "label": "Area", "required": True,
     "options": ["Billing", "Access and sign-in", "Performance", "Data", "Something else"]},
    {"id": "other", "type": "text", "label": "Which area?", "required": True,
     "visible_when": {"field": "area", "equals": "Something else"}},
    {"id": "details", "type": "textarea", "label": "Details", "map_to": "description",
     "help": "What you did, what you expected, what happened."},
    {"id": "since", "type": "date", "label": "Since when"},
    {"id": "impact", "type": "rating", "label": "How much does it hurt?", "max": 5},
    {"id": "screenshot", "type": "file", "label": "Screenshot"},
]


EQUIPMENT_FIELDS = [
    {"id": "title", "type": "text", "label": "What do you need?", "required": True, "map_to": "title"},
    {"id": "kind", "type": "select", "label": "Kind", "required": True,
     "options": ["Laptop", "Monitor", "Headset", "Phone", "Software licence"]},
    {"id": "why", "type": "textarea", "label": "Why", "map_to": "description"},
    {"id": "by", "type": "date", "label": "Needed by", "map_to": "due_date"},
    {"id": "urgent", "type": "multiselect", "label": "Flags", "options": ["Blocks my work", "New starter"]},
]


PARTNER_FIELDS = [
    {"id": "company", "type": "text", "label": "Company", "required": True, "map_to": "name"},
    {"id": "email", "type": "email", "label": "Contact email", "required": True, "map_to": "email"},
    {"id": "country", "type": "text", "label": "Country", "map_to": "country"},
    {"id": "size", "type": "select", "label": "Company size", "options": ["1–50", "51–500", "500+"]},
    {"id": "seats", "type": "number", "label": "Expected seats"},
]
