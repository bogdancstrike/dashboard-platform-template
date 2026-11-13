"""Seed data for Time & decisions: time, timesheets, approvals, SLA policies, forms.

Written against what the main seed already made — its people, tasks, tickets,
customers and reports — rather than as part of the in-memory `World`, because
every row here *refers* to that world and none of it is referred to by it.

Every part is idempotent and additive, so the same functions are both the seed
step and the `--sync-*` repairs for a database seeded before the feature:

    python -m src.seed --sync-approvals   # change rules and a queue of requests
    python -m src.seed --sync-time        # six weeks of time and timesheets
    python -m src.seed --sync-sla         # calendars and policies, applied to tickets
    python -m src.seed --sync-forms       # intake forms and their submissions

Dates are relative to now, so a database seeded today and opened in a month
still shows "last week" as last week.
"""

from __future__ import annotations

import random
from datetime import date, datetime, time, timedelta
from typing import Any

from sqlalchemy import func, select

from src.core.clock import now

RNG_SEED = 20261112

NOTES = (
    "Pairing on the fix", "Customer call", "Reviewed the pull request", "Investigated logs",
    "Wrote the runbook", "Planning with the team", "Reproduced the issue", "Deployed to staging",
    "Followed up by email", "Load testing", "Data clean-up", "Design review", "",
    "", "",
)


def _personas(session) -> dict[str, Any]:
    from src.models.identity import User
    from src.seed.identity import PERSONA_DOMAIN, PERSONAS

    found = {}
    for username, *_rest in PERSONAS:
        user = session.scalars(select(User).where(User.email == f"{username}@{PERSONA_DOMAIN}")).first()
        if user is not None:
            found[username] = user
    return found


def _system(session, user):
    """A principal for writes the seed makes on somebody's behalf."""
    from src.core.auth import ALL_PERMISSIONS, Principal

    return Principal(user_id=user.id, subject="", email=user.email, username=user.username,
                     full_name=user.full_name, role_code="ADMINISTRATOR",
                     permissions=frozenset(ALL_PERMISSIONS))


# ── Approvals ───────────────────────────────────────────────────────────


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


def _decide(row, person, status: str, comment: str, at: datetime) -> None:
    from src.services.decisions.approvals import _event

    row.status = status
    row.decided_at = at
    row.decided_by_id = person.id
    row.decision_comment = comment
    row.history = [*(row.history or []), _event(status, actor_id=person.id, actor_label=person.full_name,
                                                comment=comment, at=at)]


# ── Time ────────────────────────────────────────────────────────────────


def populate_time(session) -> dict[str, int]:
    from src.models.business import Project, Task, Ticket
    from src.models.identity import User
    from src.models.timekeeping import TimeEntry, Timesheet
    from src.services.decisions import approvals
    from src.services.decisions.timekeeping import week_start

    people = _personas(session)
    if "manager" not in people:
        return {"entries": 0, "timesheets": 0}
    if session.scalar(select(func.count()).select_from(TimeEntry)):
        return {"entries": 0, "timesheets": 0}
    rng = random.Random(RNG_SEED + 2)
    today = now().date()
    this_week = week_start(today)
    weeks = [this_week - timedelta(days=7 * offset) for offset in range(6, -1, -1)]

    workers = [people[name] for name in ("operator", "analyst", "manager", "admin") if name in people]
    workers += list(session.scalars(
        select(User).where(User.deleted_at.is_(None), User.status == "ACTIVE",
                           User.username.notin_(tuple(people)), User.id.in_(
                               select(Task.assignee_id).where(Task.assignee_id.is_not(None))))
        .order_by(User.created_at).limit(14)
    ).unique())
    projects = {p.id: p for p in session.scalars(select(Project).where(Project.deleted_at.is_(None))).unique()}
    any_tasks = list(session.scalars(select(Task).where(Task.deleted_at.is_(None)).limit(200)).unique())
    any_tickets = list(session.scalars(select(Ticket).where(Ticket.deleted_at.is_(None)).limit(200)).unique())

    entries = 0
    sheets = 0
    manager = people["manager"]
    for person_index, person in enumerate(workers):
        mine_tasks = [t for t in any_tasks if t.assignee_id == person.id] or rng.sample(any_tasks, min(4, len(any_tasks)))
        mine_tickets = [t for t in any_tickets if t.assignee_id == person.id] or rng.sample(any_tickets, min(3, len(any_tickets)))
        pool: list[tuple[str, Any]] = [("task", t) for t in mine_tasks[:6]] + [("ticket", t) for t in mine_tickets[:4]]
        for start in weeks:
            week_minutes = 0
            billable_minutes = 0
            for offset in range(5):
                day = start + timedelta(days=offset)
                if day > today:
                    break
                budget = rng.choice((390, 420, 450, 480, 480, 510))
                if day == today:
                    budget = min(budget, max(0, (now().hour - 8) * 60))
                clock = datetime.combine(day, time(8, rng.choice((0, 15, 30, 45))), now().tzinfo)
                while budget > 20:
                    kind, item = rng.choice(pool)
                    minutes = min(budget, rng.choice((30, 45, 60, 75, 90, 120, 150)))
                    project = projects.get(item.project_id) if item.project_id else None
                    label = f"{item.reference} · {item.title if kind == 'task' else item.subject}"
                    timed = rng.random() < 0.55
                    billable = rng.random() < (0.85 if kind == "ticket" else 0.7)
                    session.add(TimeEntry(
                        user_id=person.id, subject_type=kind, subject_id=item.id, subject_label=label[:240],
                        project_id=item.project_id,
                        customer_id=(item.customer_id if kind == "ticket" else (project.customer_id if project else None)),
                        work_date=day, started_at=clock if timed else None,
                        ended_at=clock + timedelta(minutes=minutes) if timed else None,
                        minutes=minutes, note=rng.choice(NOTES) or None, billable=billable,
                        source="TIMER" if timed else rng.choice(("MANUAL", "GRID")),
                    ))
                    entries += 1
                    clock += timedelta(minutes=minutes + rng.choice((0, 0, 15, 30)))
                    budget -= minutes
                    week_minutes += minutes
                    billable_minutes += minutes if billable else 0
            if start == this_week or not week_minutes:
                continue
            age = (this_week - start).days // 7
            status = "APPROVED"
            if age == 1:
                status = ("SUBMITTED", "SUBMITTED", "REJECTED", "DRAFT")[person_index % 4]
            if person.username == "operator" and age == 1:
                status = "SUBMITTED"
            sheet = Timesheet(user_id=person.id, week_start=start, status=status, total_minutes=week_minutes,
                              billable_minutes=billable_minutes)
            if status != "DRAFT":
                sheet.submitted_at = datetime.combine(start + timedelta(days=4), time(16, 30), now().tzinfo)
            session.add(sheet)
            session.flush()
            sheets += 1
            if status == "DRAFT":
                continue
            hours = week_minutes / 60
            approver = manager if person.id != manager.id else people.get("admin", manager)
            row = approvals.submit(
                session, kind="timesheet", requester_id=person.id, requester_label=person.full_name,
                title=f"Timesheet · week of {start.strftime('%d %b %Y')} · {hours:.1f} h",
                summary=f"{hours:.1f} hours, {billable_minutes / 60:.1f} billable.",
                subject_type="timesheet", subject_id=sheet.id, subject_label=f"{person.full_name} · {start.isoformat()}",
                link=f"/time?tab=week&week={start.isoformat()}&user={person.id}",
                payload={"timesheet_id": str(sheet.id), "week_start": start.isoformat(),
                         "total_minutes": week_minutes, "billable_minutes": billable_minutes},
                assignee_id=approver.id, created_at=sheet.submitted_at, notify=False,
            )
            sheet.approval_id = row.id
            if status in ("APPROVED", "REJECTED"):
                decided = sheet.submitted_at + timedelta(hours=rng.choice((3, 18, 26, 40)))
                comment = "" if status == "APPROVED" else "Tuesday has no project on two entries — fix and resend."
                _decide(row, approver, status, comment, decided)
                sheet.decided_at = decided
                sheet.decided_by_id = approver.id
                sheet.decision_comment = comment or None
    session.flush()
    return {"entries": entries, "timesheets": sheets}


# ── SLA ─────────────────────────────────────────────────────────────────


def _holidays(today: date) -> list[dict[str, str]]:
    out = []
    for year in (today.year, today.year + 1):
        for month, day, name in ((1, 1, "New Year's Day"), (5, 1, "Labour Day"), (10, 3, "Unity Day"),
                                 (12, 25, "Christmas Day"), (12, 26, "Boxing Day")):
            out.append({"date": date(year, month, day).isoformat(), "name": name})
    return out


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


# ── Forms ───────────────────────────────────────────────────────────────


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
