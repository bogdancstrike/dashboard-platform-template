"""Seed data for decisions: populate_forms, populate."""

from __future__ import annotations

import random
from datetime import timedelta

from sqlalchemy import func, select

from src.core.clock import now
from src.seed.decisions.approvals import populate_approvals
from src.seed.decisions.personas import RNG_SEED, _personas
from src.seed.decisions.sla_policies import (
    EQUIPMENT_FIELDS,
    PARTNER_FIELDS,
    SUPPORT_FIELDS,
    populate_sla,
)
from src.seed.decisions.time_entries import populate_time


def populate_forms(session) -> dict[str, int]:
    from src.models.business import Ticket
    from src.models.forms import FormSubmission, IntakeForm
    from src.services.decisions.forms import DEFAULT_SETTINGS

    people = _personas(session)
    if "manager" not in people:
        return {"forms": 0, "submissions": 0}
    if session.scalar(select(func.count()).select_from(IntakeForm)):
        return {"forms": 0, "submissions": 0}
    rng = random.Random(RNG_SEED + 4)
    manager = people["manager"]
    support = IntakeForm(
        name="Customer support request", slug="support", target="ticket", status="PUBLISHED",
        description="Tell us what is wrong and we will get back to you within one working day.",
        fields=SUPPORT_FIELDS, owner_id=manager.id,
        settings={**DEFAULT_SETTINGS, "visibility": "PUBLIC", "captcha": True, "rate_limit_per_hour": 10,
                  "defaults": {"priority": "NORMAL", "category": "SUPPORT"},
                  "notify_user_ids": [str(manager.id)],
                  "confirmation": "Thank you — your request is with our support team. We reply within one working day.",
                  "submit_label": "Send request"},
    )
    equipment = IntakeForm(
        name="IT equipment request", slug="it-equipment", target="task", status="PUBLISHED",
        description="Ask IT for hardware or software. Requests become tasks on the IT board.",
        fields=EQUIPMENT_FIELDS, owner_id=manager.id,
        settings={**DEFAULT_SETTINGS, "visibility": "INTERNAL", "captcha": False,
                  "defaults": {"priority": "NORMAL", "kind": "TASK"},
                  "confirmation": "Got it — IT will pick this up this week.", "submit_label": "Request"},
    )
    partner = IntakeForm(
        name="Partner programme sign-up", slug="partners", target="customer", status="DRAFT",
        description="Companies interested in reselling Nucleus.", fields=PARTNER_FIELDS, owner_id=manager.id,
        settings={**DEFAULT_SETTINGS, "visibility": "PUBLIC", "defaults": {"lifecycle_stage": "LEAD"}},
    )
    session.add_all([support, equipment, partner])
    session.flush()

    portal = list(session.scalars(select(Ticket).where(Ticket.deleted_at.is_(None), Ticket.channel == "PORTAL")
                                  .order_by(Ticket.created_at.desc()).limit(14)).unique())
    submissions = 0
    for index, ticket in enumerate(portal):
        first = rng.choice(("Dana", "Lior", "Priya", "Tomás", "Mei", "Jonas", "Amara", "Kofi"))
        session.add(FormSubmission(
            form_id=support.id, reference=f"SUB-{index + 1:05d}", status="CONVERTED",
            data={"name": f"{first} {rng.choice(('Ng', 'Silva', 'Okafor', 'Berg', 'Rossi'))}",
                  "email": f"{first.lower()}@example.com", "subject": ticket.subject,
                  "area": rng.choice(("Billing", "Access and sign-in", "Performance", "Data")),
                  "details": (ticket.description or "")[:300], "impact": rng.randint(2, 5)},
            record_type="ticket", record_id=str(ticket.id),
            record_label=f"{ticket.reference}"[:240], submitter_email=f"{first.lower()}@example.com",
            created_at=ticket.created_at,
        ))
        submissions += 1
    session.add(FormSubmission(
        form_id=support.id, reference=f"SUB-{len(portal) + 1:05d}", status="FAILED",
        data={"name": "Sam Doe", "email": "sam@example.com", "subject": "", "area": "Data"},
        error="Subject is required.", submitter_email="sam@example.com", created_at=now() - timedelta(hours=5)))
    session.add(FormSubmission(form_id=support.id, reference=f"SUB-{len(portal) + 2:05d}", status="SPAM",
                               data={}, created_at=now() - timedelta(hours=11)))
    support.submission_count = submissions + 1
    session.flush()
    return {"forms": 3, "submissions": submissions + 2}


def populate(session) -> dict[str, dict[str, int]]:
    """Everything, in dependency order: SLA before tickets are read, approvals before timesheets."""
    return {
        "sla": populate_sla(session),
        "approvals": populate_approvals(session),
        "time": populate_time(session),
        "forms": populate_forms(session),
    }
