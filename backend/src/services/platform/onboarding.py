"""Onboarding (§38): a checklist per role, empty-state guides, and sample data.

**The checklist differs by role** because the first week differs by role: an
administrator invites people, sets roles, connects a system and configures an
SLA; a manager builds a dashboard and a board; an operator triages, logs time
and closes a task; an analyst saves a search and runs a report.

**Most steps tick themselves off.** A step names a check — "has this person
created a dashboard", "has this person changed a role" — answered from the
records and the audit log, so the checklist reflects what was *done*, not what
was clicked. A person may still mark a step done or skip it; that answer is a
row in `onboarding_steps`. Progress is per person.

**Sample data is tagged and removable.** Loading an area creates records
through the records API's own bulk create (validated, named, audited without
flooding the activity feed) and records every id in `sample_records`; removing
it deletes exactly those ids — and nothing else — so a demo can be undone on a
database that also holds real work. Administrators only.
"""

from __future__ import annotations

import random
import uuid
from dataclasses import dataclass
from datetime import timedelta
from typing import Any, Callable

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from src.core.clock import iso, now
from src.core.errors import NotFoundError, ValidationError
from src.core.repository import found_or_404
from src.models.onboarding import OnboardingStep, SampleRecord

SAMPLE_PERMISSION = "admin.access"
CARD_KEY = "card"
STATES = ("DONE", "SKIPPED")


@dataclass(frozen=True)
class Step:
    key: str
    title: str
    description: str
    to: str
    action: str
    #: Who may see the step at all (beyond the role list).
    permission: str | None = None
    #: How it ticks itself off: (session, user_id) -> bool.
    check: Callable[..., bool] | None = None


def _audited(resource_type: str, *actions: str) -> Callable[..., bool]:
    def check(session, user_id) -> bool:
        from src.models.platform import AuditLog

        statement = select(AuditLog.id).where(AuditLog.actor_id == user_id, AuditLog.resource_type == resource_type)
        if actions:
            statement = statement.where(AuditLog.action.in_(actions))
        return session.scalar(statement.limit(1)) is not None
    return check


def _owns(model_path: str, column: str = "owner_id", **extra: Any) -> Callable[..., bool]:
    def check(session, user_id) -> bool:
        module, name = model_path.rsplit(".", 1)
        model = getattr(__import__(module, fromlist=[name]), name)
        statement = select(model.id).where(getattr(model, column) == user_id)
        for key, value in extra.items():
            statement = statement.where(getattr(model, key) == value)
        return session.scalar(statement.limit(1)) is not None
    return check


def _any(model_path: str, **where: Any) -> Callable[..., bool]:
    def check(session, _user_id) -> bool:
        module, name = model_path.rsplit(".", 1)
        model = getattr(__import__(module, fromlist=[name]), name)
        statement = select(model.id)
        for key, value in where.items():
            statement = statement.where(getattr(model, key) == value)
        return session.scalar(statement.limit(1)) is not None
    return check


def _profile(session, user_id) -> bool:
    from src.models.identity import User

    user = session.get(User, user_id)
    return bool(user and (user.job_title or user.phone) and (user.profile_completeness or 0) >= 80)


def _published_workflow(session, user_id) -> bool:
    from src.models.automation_graphs import AutomationVersion

    return session.scalar(select(AutomationVersion.id).where(AutomationVersion.published_by_id == user_id).limit(1)) is not None


S = {
    "profile": Step("profile", "Complete your profile", "A job title and a phone number help colleagues know who to ask.",
                    "/profile", "Open profile", check=_profile),
    "tour": Step("tour", "Take a page tour", "Press Help & page tour on any page — every stop explains why, not what.",
                 "/home", "Open Home"),
    "favorite": Step("favorite", "Star something you use daily", "Favourites sit on Home and in the palette.",
                     "/favorites", "Open favourites", check=_owns("src.models.personal.Favorite", "user_id")),
    "invite": Step("invite", "Invite your team", "Add the people who will work here; they sign in with their own account.",
                   "/admin/users", "Open users", "users.manage", _audited("user", "CREATE", "INVITE")),
    "roles": Step("roles", "Set roles and permissions", "Decide what each role may see and do — the matrix is the whole policy.",
                  "/admin/roles", "Open roles", "roles.manage", _audited("role")),
    "integration": Step("integration", "Connect an integration", "Mail, storage or an external system — configured once, used everywhere.",
                        "/admin/integrations", "Open integrations", "integrations.manage",
                        _any("src.models.platform.Integration", enabled=True)),
    "sla": Step("sla", "Configure an SLA policy", "Targets per priority with business hours, so tickets show when they are late.",
                "/admin/sla", "Open SLA policies", None, _audited("sla_policy")),
    "api_client": Step("api_client", "Register an API client", "A key for the systems that call this platform; usage is charted per client.",
                       "/admin/api", "Open API clients", "api.manage", _owns("src.models.platform.ApiClient")),
    "workflow": Step("workflow", "Publish a workflow", "Draw one on the canvas: a trigger, a condition, an action — then publish.",
                     "/workflows", "Open workflows", "automations.manage", _published_workflow),
    "dashboard": Step("dashboard", "Create a dashboard", "Pin the numbers your team watches; share it when it is right.",
                      "/dashboards", "Open dashboards", "dashboards.manage", _owns("src.models.personal.Dashboard")),
    "board": Step("board", "Set up a board", "A kanban board for the team's work, lanes and limits your way.",
                  "/kanban", "Open boards", "tasks.view", _owns("src.models.kanban.Board")),
    "sprint": Step("sprint", "Plan a sprint", "Drag backlog work into a sprint and start it.", "/sprints", "Open sprints",
                   "tasks.view", _owns("src.models.planning.Sprint", "created_by_id")),
    "triage": Step("triage", "Triage a ticket", "Pick one from the queue, set its priority and assignee.", "/tickets",
                   "Open tickets", "records.update", _audited("ticket", "UPDATE", "STATUS_CHANGE")),
    "complete_task": Step("complete_task", "Move a task forward", "Change a task's status on the board or its page.",
                          "/tasks", "Open tasks", "records.update", _audited("task", "UPDATE", "STATUS_CHANGE")),
    "log_time": Step("log_time", "Log time", "Start the timer in the header, or add an entry to your timesheet.", "/time",
                     "Open time", "time.track", _owns("src.models.timekeeping.TimeEntry", "user_id")),
    "comment": Step("comment", "Leave a comment", "Mention a colleague on a record; they are notified live.", "/tasks",
                    "Open tasks", "records.comment", _owns("src.models.content.Comment", "author_id")),
    "search": Step("search", "Save a search", "Build a query in the Data Explorer and save it for later.", "/explore",
                   "Open the explorer", "records.view", _owns("src.models.personal.SavedSearch")),
    "report": Step("report", "Build a report", "Group, measure and chart — then save or schedule it.", "/reports/builder",
                   "Open the report builder", "reports.manage", _owns("src.models.personal.Report")),
}

ROLES: dict[str, tuple[str, ...]] = {
    "ADMINISTRATOR": ("profile", "invite", "roles", "integration", "sla", "api_client", "workflow", "tour"),
    "MANAGER": ("profile", "dashboard", "board", "sprint", "workflow", "comment", "tour"),
    "OPERATOR": ("profile", "triage", "complete_task", "log_time", "comment", "favorite"),
    "ANALYST": ("profile", "search", "report", "dashboard", "favorite", "tour"),
    "VIEWER": ("profile", "favorite", "search", "tour"),
}


def _steps_for(principal) -> list[Step]:
    keys = ROLES.get(principal.role_code, ROLES["VIEWER"])
    return [S[key] for key in keys if S[key].permission is None or principal.can(S[key].permission)]


def checklist(session, *, principal) -> dict[str, Any]:
    """This person's checklist, with progress — derived checks and own answers merged."""
    answers = {row.step_key: row for row in session.scalars(
        select(OnboardingStep).where(OnboardingStep.user_id == principal.user_id)).all()}
    steps = []
    for step in _steps_for(principal):
        answer = answers.get(step.key)
        auto = False
        if step.check is not None:
            try:
                with session.begin_nested():
                    auto = bool(step.check(session, principal.user_id))
            except Exception:  # noqa: BLE001 - a check that cannot run is just not done
                auto = False
        state = "done" if auto else (answer.status.lower() if answer else "todo")
        steps.append({
            "key": step.key, "title": step.title, "description": step.description, "to": step.to,
            "action": step.action, "state": state, "auto": auto, "automatic": step.check is not None,
            "completed_at": iso(answer.completed_at) if answer and not auto else None,
        })
    finished = sum(1 for step in steps if step["state"] in ("done", "skipped"))
    card = answers.get(CARD_KEY)
    return {
        "role": principal.role_code,
        "steps": steps,
        "progress": {"done": finished, "total": len(steps),
                     "percent": round(100 * finished / len(steps)) if steps else 100},
        "dismissed": bool(card and card.status == "DISMISSED"),
        "can_load_samples": principal.can(SAMPLE_PERMISSION),
    }


def answer(session, key: str, payload: dict[str, Any] | None, *, principal) -> dict[str, Any]:
    """Mark a step done or skipped — or back to to-do."""
    if key not in {step.key for step in _steps_for(principal)}:
        raise NotFoundError("That step is not on your checklist.")
    state = str((payload or {}).get("state") or "").upper()
    row = session.scalar(select(OnboardingStep).where(
        OnboardingStep.user_id == principal.user_id, OnboardingStep.step_key == key))
    if state == "TODO":
        if row is not None:
            session.delete(row)
    elif state in STATES:
        if row is None:
            row = OnboardingStep(user_id=principal.user_id, step_key=key, status=state)
            session.add(row)
        row.status = state
        row.completed_at = now()
    else:
        raise ValidationError("state must be done, skipped or todo.", details={"allowed": ["done", "skipped", "todo"]})
    session.flush()
    return checklist(session, principal=principal)


def dismiss(session, payload: dict[str, Any] | None, *, principal) -> dict[str, Any]:
    """Hide (or bring back) the checklist card on Home."""
    dismissed = bool((payload or {}).get("dismissed", True))
    row = session.scalar(select(OnboardingStep).where(
        OnboardingStep.user_id == principal.user_id, OnboardingStep.step_key == CARD_KEY))
    if dismissed and row is None:
        session.add(OnboardingStep(user_id=principal.user_id, step_key=CARD_KEY, status="DISMISSED", completed_at=now()))
    elif not dismissed and row is not None:
        session.delete(row)
    session.flush()
    return checklist(session, principal=principal)


# ── Sample data ──────────────────────────────────────────────────────────

CUSTOMERS = ("Halvorsen Logistics", "Bright Harbor Foods", "Kestrel Analytics", "Mosaic Health Partners",
             "Northgate Utilities", "Pinewood Studios", "Quayside Retail Group", "Solent Marine Services")
PROJECTS = ("Warehouse scanner rollout", "Customer portal refresh", "Billing system migration",
            "Field service mobile app", "Data platform consolidation")
TASKS = ("Draft the rollout plan", "Review vendor contract", "Set up staging environment", "Write acceptance tests",
         "Migrate historical invoices", "Train the support team", "Configure single sign-on", "Fix export timeout",
         "Design the onboarding emails", "Audit user permissions", "Prepare the steering update", "Load-test the API")
TICKETS = ("Cannot reset password", "Invoice total is off by one cent", "Export to CSV times out", "Need access to reports",
           "Dashboard loads slowly", "Duplicate notification emails", "Wrong timezone on due dates", "Feature request: dark mode")
DEVICES = ("Dock door sensor", "Cold room thermometer", "Gateway — north wing", "Camera — loading bay",
           "Energy meter — line 2", "Beacon — reception")

AREAS: dict[str, dict[str, Any]] = {
    "customers": {"label": "Customers", "resource": "customer", "route": "/customers"},
    "projects": {"label": "Projects", "resource": "project", "route": "/projects"},
    "tasks": {"label": "Tasks", "resource": "task", "route": "/tasks"},
    "tickets": {"label": "Tickets", "resource": "ticket", "route": "/tickets"},
    "orders": {"label": "Orders", "resource": "order", "route": "/orders"},
    "devices": {"label": "Devices", "resource": "device", "route": "/devices"},
}


def _payloads(area: str, rng: random.Random) -> list[dict[str, Any]]:
    today = now()
    note = "Sample data — remove it from Getting started → Sample data."
    if area == "customers":
        return [{"name": name, "email": f"hello@{name.split()[0].lower()}.example", "status": "ACTIVE",
                 "segment": rng.choice(("SMB", "MID_MARKET", "ENTERPRISE")), "industry": rng.choice(("Logistics", "Retail", "Health", "Energy", "Media")),
                 "lifecycle_stage": rng.choice(("PROSPECT", "CUSTOMER", "RENEWAL")), "country": rng.choice(("GB", "DE", "NL", "RO")),
                 "lifetime_value": rng.randint(8, 400) * 1000, "satisfaction": round(rng.uniform(6, 9.8), 1)} for name in CUSTOMERS]
    if area == "projects":
        return [{"name": name, "description": note, "status": rng.choice(("ACTIVE", "PLANNING")), "phase": rng.choice(("DISCOVERY", "EXECUTION")),
                 "priority": rng.choice(("NORMAL", "HIGH")), "health": rng.choice(("ON_TRACK", "AT_RISK")),
                 "start_date": (today - timedelta(days=rng.randint(5, 40))).isoformat(),
                 "due_date": (today + timedelta(days=rng.randint(20, 120))).isoformat(),
                 "budget": rng.randint(20, 300) * 1000, "currency": "EUR", "progress": rng.randint(5, 70)} for name in PROJECTS]
    if area == "tasks":
        return [{"title": title, "description": note, "status": rng.choice(("NEW", "IN_PROGRESS", "IN_REVIEW", "DONE")),
                 "priority": rng.choice(("LOW", "NORMAL", "HIGH", "CRITICAL")), "kind": rng.choice(("TASK", "BUG", "FEATURE")),
                 "due_date": (today + timedelta(days=rng.randint(-3, 21))).isoformat(), "estimate_hours": rng.randint(1, 16)}
                for title in TASKS]
    if area == "tickets":
        return [{"subject": subject, "description": note, "status": rng.choice(("OPEN", "IN_PROGRESS", "WAITING_CUSTOMER")),
                 "priority": rng.choice(("LOW", "NORMAL", "HIGH", "CRITICAL")), "category": rng.choice(("SUPPORT", "BUG", "BILLING", "ACCESS")),
                 "channel": rng.choice(("EMAIL", "PORTAL", "CHAT"))} for subject in TICKETS]
    if area == "orders":
        return [{"status": rng.choice(("CONFIRMED", "PROCESSING", "SHIPPED", "DELIVERED")), "payment_status": rng.choice(("PAID", "UNPAID")),
                 "channel": rng.choice(("DIRECT", "PORTAL", "PARTNER")), "placed_at": (today - timedelta(days=rng.randint(0, 30))).isoformat(),
                 "total": rng.randint(120, 9000), "currency": "EUR", "item_count": rng.randint(1, 12), "notes": note} for _ in range(8)]
    return [{"name": name, "kind": rng.choice(("SENSOR", "GATEWAY", "CAMERA", "METER", "BEACON")), "manufacturer": "Acme IoT",
             "status": rng.choice(("ONLINE", "ONLINE", "DEGRADED", "OFFLINE")), "location": "Sample site",
             "battery_percent": rng.randint(20, 100), "signal_strength": rng.randint(-95, -40)} for name in DEVICES]


def samples(session, *, principal) -> dict[str, Any]:
    principal.require(SAMPLE_PERMISSION)
    counts = dict(session.execute(select(SampleRecord.area, func.count()).group_by(SampleRecord.area)).all())
    return {"areas": [{"key": key, "label": spec["label"], "route": spec["route"], "loaded": int(counts.get(key, 0))}
                      for key, spec in AREAS.items()]}


def load(session, area: str, *, principal) -> dict[str, Any]:
    """Create a tagged sample dataset for one area. Refused if it is already loaded."""
    from src.services.records import writes as record_writes
    from src.services.records.explorer import resources

    principal.require(SAMPLE_PERMISSION)
    spec = found_or_404(
        AREAS.get(area), "There is no sample data for that area.", details={"areas": sorted(AREAS)}
    )
    if session.scalar(select(SampleRecord.id).where(SampleRecord.area == area).limit(1)):
        raise ValidationError(f"Sample {spec['label'].lower()} are already loaded — remove them first to load again.")
    rows = record_writes.create_many(session, spec["resource"], _payloads(area, random.Random(area)), principal=principal)
    resource = resources()[spec["resource"]]
    batch = uuid.uuid4().hex
    for row in rows:
        session.add(SampleRecord(area=area, batch_id=batch, resource_type=spec["resource"], record_id=str(row.id),
                                 label=resource.label_for(row)[:240], created_by_id=principal.user_id))
    session.flush()
    return {"area": area, "created": len(rows), **samples(session, principal=principal)}


def remove(session, area: str, *, principal) -> dict[str, Any]:
    """Delete exactly the records a load created — nothing else."""
    from src.services.records.explorer import resources

    principal.require(SAMPLE_PERMISSION)
    if area not in AREAS:
        raise NotFoundError("There is no sample data for that area.")
    tags = session.scalars(select(SampleRecord).where(SampleRecord.area == area)).all()
    sample_ids = set(session.scalars(select(SampleRecord.record_id)).all())
    removed = kept = 0
    for tag in tags:
        resource = resources().get(tag.resource_type)
        row = session.get(resource.model, uuid.UUID(tag.record_id)) if resource else None
        if row is not None:
            if _referenced(session, resource.model.__table__, row.id, sample_ids):
                # Something real now points at it (a real task in a sample
                # project, say). Deleting would null or break that reference,
                # which is touching real data — so it is hidden instead.
                row.deleted_at = now()
                kept += 1
            else:
                try:
                    with session.begin_nested():
                        session.delete(row)
                        session.flush()
                    removed += 1
                except IntegrityError:  # pragma: no cover - guarded by _referenced
                    row.deleted_at = now()
                    kept += 1
        session.delete(tag)
    session.flush()
    return {"area": area, "removed": removed, "hidden": kept, **samples(session, principal=principal)}


def _referenced(session, table, record_id, sample_ids: set[str]) -> bool:
    """Whether any row that is not itself sample data points at this record."""
    from sqlalchemy import column as sql_column, table as sql_table

    from src.models.base import Base

    for other in Base.metadata.sorted_tables:
        for key in other.foreign_keys:
            if key.column.table is not table:
                continue
            if "id" not in other.c:
                # An association row (no id of its own) is always real.
                link = sql_table(other.name, sql_column(key.parent.name))
                if session.execute(select(link.c[key.parent.name]).where(
                        link.c[key.parent.name] == record_id).limit(1)).first():
                    return True
                continue
            referrer = sql_table(other.name, sql_column(key.parent.name), sql_column("id"))
            ids = [str(value) for value in session.execute(
                select(referrer.c.id).where(referrer.c[key.parent.name] == record_id).limit(50)
            ).scalars()]
            if any(item not in sample_ids for item in ids):
                return True
    return False
