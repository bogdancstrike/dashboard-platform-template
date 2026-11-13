"""Seed data for planning: POINTS, SEED, EPICS."""

from __future__ import annotations

import random
from datetime import date, datetime, time, timedelta, timezone
from typing import Any

from sqlalchemy import select

from src.core.clock import now

POINTS = (1, 2, 3, 5, 5, 8, 13)


SEED = 20261112


EPICS = (
    ("Customer self-service portal", "#2457D6"),
    ("Billing platform migration", "#7c3aed"),
    ("Mobile field app", "#0891b2"),
    ("Data warehouse refresh", "#16a34a"),
    ("Single sign-on rollout", "#ca8a04"),
    ("Observability and alerting", "#dc2626"),
    ("Partner API v2", "#db2777"),
    ("Onboarding redesign", "#0d9488"),
)


STORIES = (
    "Sign-in with the company identity provider", "Invoice PDF matches the legal template",
    "Search orders by customer reference", "Export the ledger to CSV", "Offline mode for site visits",
    "Push notification when a job is assigned", "Dashboard of overdue invoices",
    "Rate-limit the public API", "Audit trail for price changes", "Bulk import of devices",
    "Password reset by SMS", "Payment retry on card decline", "Map view of open work orders",
    "Health check for the payment gateway", "Webhook for order status changes",
    "Archive tickets older than two years", "Role for read-only auditors", "Customer churn report",
    "Feature flag for the new checkout", "Accessibility pass on the forms",
    "Translate the portal into German", "Reconcile refunds nightly", "Trace slow database queries",
    "Alert when the queue backs up", "Self-service address change", "Contract renewal reminders",
    "Photo upload on inspections", "Signature capture on delivery", "SLA timer on priority tickets",
    "Usage metering per API key", "Merge duplicate customers", "Two-factor for administrators",
)


BUGS = (
    "Totals off by a cent on multi-currency orders", "Session expires during long uploads",
    "Date picker shows the wrong week start", "Duplicate notification on reassign",
    "Export times out over 50k rows", "Avatar missing for new users", "Search ignores accents",
)


MILESTONES = ("Beta to pilot customers", "General availability", "Security review signed off", "Data migration cut-over")


BLOCKERS = (
    "Waiting on the vendor's sandbox credentials", "Needs a decision from legal on retention",
    "Blocked by the identity provider upgrade", "Design sign-off pending",
)


TEMPLATES = (
    {
        "name": "Bug triage", "title": "Triage: ", "kind": "BUG", "priority": "HIGH",
        "estimate_hours": 2, "story_points": 2, "due_in_days": 2, "cover_color": "#dc2626",
        "description": "Reproduce, assess impact, assign an owner and a target release.",
        "checklist": ["Reproduce on staging", "Capture logs and correlation id", "Assess customer impact", "Assign owner and release"],
    },
    {
        "name": "Release checklist", "title": "Release ", "kind": "CHORE", "priority": "NORMAL",
        "estimate_hours": 6, "story_points": 3, "due_in_days": 5, "cover_color": "#2457D6",
        "description": "Everything a release needs before it leaves staging.",
        "checklist": ["Freeze the branch", "Run the regression suite", "Write release notes", "Deploy to production", "Watch the error rate for an hour"],
    },
    {
        "name": "New starter onboarding", "title": "Onboard ", "kind": "REQUEST", "priority": "NORMAL",
        "estimate_hours": 8, "story_points": None, "due_in_days": 10, "cover_color": "#16a34a",
        "description": "Accounts, hardware and a buddy for somebody joining the team.",
        "checklist": ["Order the laptop", "Create accounts", "Add to the team channels", "Pair with a buddy for week one", "30-day check-in"],
    },
    {
        "name": "Security patch", "title": "Patch: ", "kind": "TASK", "priority": "CRITICAL",
        "estimate_hours": 4, "story_points": 3, "due_in_days": 3, "cover_color": "#ca8a04",
        "description": "Apply and verify a security update across the fleet.",
        "checklist": ["Read the advisory", "Patch staging", "Patch production", "Verify versions", "Close the advisory"],
    },
    {
        "name": "User story", "title": "As a customer, I want ", "kind": "STORY", "priority": "NORMAL",
        "estimate_hours": 12, "story_points": 5, "due_in_days": 14, "cover_color": None,
        "description": "So that … Acceptance criteria: …",
        "checklist": ["Acceptance criteria agreed", "Design reviewed", "Implemented", "Tested", "Demoed"],
    },
)


RECURRING = (
    ("Weekly operations review", {"frequency": "WEEKLY", "weekdays": [0]}, 1),
    ("Rotate on-call handover notes", {"frequency": "WEEKLY", "weekdays": [4]}, 1),
    ("Month-end invoice reconciliation", {"frequency": "MONTHLY", "month_day": 28}, 3),
    ("Sprint retrospective actions review", {"frequency": "CUSTOM", "interval": 2, "unit": "WEEK"}, 1),
    ("Back up the reporting database", {"frequency": "DAILY"}, 1),
)


def _at(day: date) -> datetime:
    return datetime.combine(day, time(0, 0), tzinfo=timezone.utc)


def _day(value: Any) -> date | None:
    if value is None:
        return None
    return value.astimezone(timezone.utc).date() if isinstance(value, datetime) else value


def _fill_dates(session) -> int:
    """Every open task gets a start date, so the timeline draws it as a bar."""
    from src.models.business import Task

    rng = random.Random(SEED + 1)
    rows = session.scalars(
        select(Task).where(Task.start_date.is_(None), Task.due_date.is_not(None), Task.deleted_at.is_(None))
    ).unique().all()
    for row in rows:
        hours = float(row.estimate_hours or 8)
        length = max(1, min(21, round(hours / 6) + rng.randint(0, 3)))
        start = _day(row.due_date) - timedelta(days=length)
        created = _day(row.created_at)
        if created and start < created:
            start = created
        row.start_date = _at(start)
    return len(rows)


def _fill_ages(session) -> int:
    """How long each card has sat in its lane — from its last plausible move."""
    from src.models.business import Task

    rng = random.Random(SEED + 2)
    rows = session.scalars(
        select(Task).where(Task.status_changed_at.is_(None), Task.deleted_at.is_(None))
    ).unique().all()
    anchor = now()
    for row in rows:
        lower = row.started_at or row.created_at or anchor - timedelta(days=30)
        if row.completed_at:
            row.status_changed_at = row.completed_at
            continue
        span = max(0, int((anchor - lower).total_seconds()))
        moved = lower + timedelta(seconds=rng.randint(0, span)) if span else lower
        # Most cards moved recently; a few have been stuck a long while.
        if rng.random() < 0.7:
            moved = max(moved, anchor - timedelta(days=rng.randint(0, 6), hours=rng.randint(0, 20)))
        row.status_changed_at = moved
    return len(rows)
