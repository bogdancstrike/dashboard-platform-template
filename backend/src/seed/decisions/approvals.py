"""Seed data for decisions: populate_approvals."""

from __future__ import annotations

import random
from datetime import datetime, timedelta

from sqlalchemy import func, select

from src.core.clock import now
from src.seed.decisions.personas import RNG_SEED, _decide, _personas


def populate_approvals(session) -> dict[str, int]:
    from src.models.approvals import ApprovalRequest, ChangeRule
    from src.models.business import Order, Ticket
    from src.models.identity import User
    from src.models.personal import Report
    from src.services.decisions import approvals

    people = _personas(session)
    if "admin" not in people or "manager" not in people:
        return {"rules": 0, "requests": 0}
    rng = random.Random(RNG_SEED + 1)
    made = {"rules": 0, "requests": 0}

    rules = (
        ("Orders above €50,000 need sign-off", "order", "total", "GT", 50000,
         "Large order values change revenue forecasts; a second person checks them."),
        ("Raising a ticket to critical", "ticket", "priority", "EQUALS", "CRITICAL",
         "Critical pages the on-call engineer, so a lead confirms it first."),
        ("Customer lifetime value edits", "customer", "lifetime_value", "ANY", None,
         "Lifetime value feeds commissions; every change is reviewed."),
    )
    for name, resource_type, field, operator, value, description in rules:
        exists = session.scalar(select(ChangeRule.id).where(ChangeRule.name == name))
        if exists:
            continue
        session.add(ChangeRule(name=name, resource_type=resource_type, field=field, operator=operator,
                               value=value, description=description, active=True,
                               created_by_id=people["admin"].id))
        made["rules"] += 1
    session.flush()

    if session.scalar(select(func.count()).select_from(ApprovalRequest).where(
            ApprovalRequest.kind.in_(("access", "change", "report")))):
        return made

    others = list(session.scalars(
        select(User).where(User.deleted_at.is_(None), User.status == "ACTIVE",
                           User.username.notin_(tuple(people)))
        .order_by(User.created_at).limit(40)
    ).unique())
    moment = now()

    def _when(hours: float) -> datetime:
        return moment - timedelta(hours=hours)

    # Access requests — some fresh, one overdue, a couple decided.
    access = [
        (people.get("user"), "audit.view", "/admin/audit", "I investigate customer complaints and need the trail.", 3),
        (people.get("analyst"), "logs.view", "/admin/logs", "To correlate report anomalies with errors.", 30),
        (people.get("operator"), "automations.manage", "/workflows", "I run the triage rules for the queue.", 52),
        (others[0] if others else None, "records.export", "/exports", "Monthly finance pack.", 7),
        (others[1] if len(others) > 1 else None, "files.manage", "/files", "Upload signed contracts.", 120),
    ]
    from src.core.auth import PERMISSION_LABELS

    for index, (person, permission, path, reason, age) in enumerate(access):
        if person is None:
            continue
        label = PERMISSION_LABELS.get(permission, permission)
        row = approvals.submit(
            session, kind="access", requester_id=person.id, requester_label=person.full_name,
            title=f"Access: {label}", summary=reason, subject_type="permission", subject_id=permission,
            subject_label=label, link=path, payload={"permission": permission, "path": path, "reason": reason},
            created_at=_when(age), notify=False,
        )
        made["requests"] += 1
        if index == 4:
            _decide(row, people["admin"], "REJECTED", "Contracts go through legal; ask Mara to upload them.",
                    _when(age - 20))

    # Change requests held back by the rules above.
    orders = list(session.scalars(select(Order).where(Order.deleted_at.is_(None)).order_by(Order.total.desc()).limit(3)))
    tickets = list(session.scalars(select(Ticket).where(Ticket.deleted_at.is_(None), Ticket.status == "OPEN",
                                                        Ticket.priority == "HIGH").limit(3)).unique())
    requesters = [people.get("operator"), *(others[2:6])]
    for index, order in enumerate(orders):
        person = requesters[index % len(requesters)] or people["manager"]
        new_total = round(float(order.total or 0) * 1.18 + 52000, 2)
        row = approvals.submit(
            session, kind="change", requester_id=person.id, requester_label=person.full_name,
            title=f"Change {order.reference}: total", summary="Orders above €50,000 need sign-off",
            subject_type="order", subject_id=order.id, subject_label=order.reference,
            link=f"/orders/{order.id}",
            payload={"resource_type": "order", "record_id": str(order.id), "values": {"total": new_total},
                     "before": {"total": float(order.total or 0)}},
            created_at=_when(5 + index * 18), notify=False,
        )
        made["requests"] += 1
        if index == 2:
            _decide(row, people["manager"], "APPROVED", "Matches the signed quote.", _when(2))
    for index, ticket in enumerate(tickets):
        person = requesters[(index + 1) % len(requesters)] or people["manager"]
        approvals.submit(
            session, kind="change", requester_id=person.id, requester_label=person.full_name,
            title=f"Change {ticket.reference}: priority", summary="Raising a ticket to critical",
            subject_type="ticket", subject_id=ticket.id, subject_label=ticket.reference,
            link=f"/tickets/{ticket.id}",
            payload={"resource_type": "ticket", "record_id": str(ticket.id), "values": {"priority": "CRITICAL"},
                     "before": {"priority": ticket.priority}},
            created_at=_when(1 + index * 9), notify=False,
        )
        made["requests"] += 1

    # Report publishing.
    reports = list(session.scalars(select(Report).where(Report.deleted_at.is_(None),
                                                        Report.scope == "PRIVATE").limit(3)).unique())
    for index, report in enumerate(reports):
        owner = session.get(User, report.owner_id) if report.owner_id else people["analyst"]
        if owner is None:
            continue
        row = approvals.submit(
            session, kind="report", requester_id=owner.id, requester_label=owner.full_name,
            title=f"Publish report: {report.name}", summary="Share this report with the whole organisation.",
            subject_type="report", subject_id=report.id, subject_label=report.name,
            link=f"/reports?report={report.id}",
            payload={"report_id": str(report.id), "scope": "ORGANIZATION", "from_scope": report.scope},
            created_at=_when(10 + 26 * index), notify=False,
        )
        made["requests"] += 1
        if index == 2:
            _decide(row, people["manager"], "REJECTED", "Hide the per-person columns first, then ask again.",
                    _when(4))
    del rng
    session.flush()
    return made
