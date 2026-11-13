"""Seed data for catalog: TASK_KINDS, BLOCKED_REASONS, TICKET_SUBJECTS."""

from __future__ import annotations

from src.core import vocabulary
from src.core.vocabulary import weighted

TASK_KINDS = vocabulary.TASK_KIND


BLOCKED_REASONS: tuple[str, ...] = (
    "Waiting on vendor response", "Blocked by upstream migration",
    "Awaiting security review", "Needs budget approval",
    "Dependent task not finished", "Waiting for customer confirmation",
    "Environment unavailable", "Pending legal sign-off",
)


TICKET_SUBJECTS: tuple[str, ...] = (
    "Cannot sign in after password reset",
    "Export finishes but the file is empty",
    "Invoice total does not match the order lines",
    "Search returns no results for valid customer codes",
    "Notification emails arrive hours late",
    "Dashboard shows yesterday's figures",
    "Bulk update silently skips some rows",
    "Device reports offline while still transmitting",
    "Permission denied on a report the user owns",
    "Duplicate records created by the importer",
    "Timezone is wrong on scheduled reports",
    "File upload fails above 10 MB",
    "API returns 500 on a valid filter combination",
    "Saved view resets its columns after reload",
    "Calendar invitations are missing attendees",
    "Two-factor prompt loops on mobile",
    "Order stuck in fulfilment for four days",
    "Audit log missing entries for bulk deletes",
    "Slow response times in the reporting module",
    "Attachment preview shows a blank page",
)


TICKET_STATUSES = weighted(
    vocabulary.TICKET_STATUS, (0.2, 0.13, 0.17, 0.09, 0.05, 0.28, 0.08)
)


TICKET_CATEGORIES = vocabulary.TICKET_CATEGORY


TICKET_CHANNELS = weighted(vocabulary.TICKET_CHANNEL, (0.38, 0.28, 0.14, 0.15, 0.05))


SEVERITIES = weighted(vocabulary.SEVERITY, (0.42, 0.32, 0.19, 0.07))


CUSTOMER_SEGMENTS = weighted(vocabulary.CUSTOMER_SEGMENT, (0.42, 0.33, 0.2, 0.05))


CUSTOMER_STATUSES = weighted(vocabulary.CUSTOMER_STATUS, (0.82, 0.12, 0.06))


LIFECYCLE_STAGES = weighted(vocabulary.LIFECYCLE_STAGE, (0.12, 0.14, 0.55, 0.12, 0.07))


ORDER_STATUSES = weighted(
    vocabulary.ORDER_STATUS, (0.12, 0.2, 0.15, 0.16, 0.29, 0.05, 0.03)
)


PAYMENT_STATUSES = weighted(vocabulary.PAYMENT_STATUS, (0.62, 0.2, 0.08, 0.05, 0.05))


ORDER_CHANNELS = vocabulary.ORDER_CHANNEL


#: Three-to-one in favour of the home currency, so totals are not uniformly mixed.
ORDER_CURRENCIES: tuple[str, ...] = ("EUR", "EUR", "EUR", "USD", "GBP")


#: (name, unit price, unit)
PRODUCTS: tuple[tuple[str, float, str], ...] = (
    ("Platform licence — Standard", 1200.0, "seat/year"),
    ("Platform licence — Enterprise", 3400.0, "seat/year"),
    ("Implementation services", 950.0, "day"),
    ("Priority support", 480.0, "month"),
    ("Data migration package", 6500.0, "project"),
    ("Additional storage — 1 TB", 220.0, "month"),
    ("Training workshop", 1750.0, "session"),
    ("Custom integration", 4200.0, "project"),
    ("Sandbox environment", 310.0, "month"),
    ("Extended audit retention", 640.0, "year"),
    ("Gateway appliance", 2890.0, "unit"),
    ("Edge sensor kit", 415.0, "unit"),
)


DEVICE_MANUFACTURERS: tuple[str, ...] = (
    "Aeris", "Bolder", "Cygnus", "Dynamo", "Elpis", "Fluxtron", "Halberd",
)


DEVICE_KINDS = weighted(vocabulary.DEVICE_KIND, (0.38, 0.18, 0.14, 0.12, 0.12, 0.06))


DEVICE_STATUSES = weighted(vocabulary.DEVICE_STATUS, (0.66, 0.14, 0.09, 0.07, 0.04))


EVENT_TITLES: tuple[str, ...] = (
    "Sprint planning", "Weekly sync", "Architecture review", "Customer demo",
    "Incident retrospective", "Quarterly business review", "1:1",
    "Design critique", "Release readiness", "Vendor call", "Budget review",
    "Onboarding session", "Security walkthrough", "Roadmap workshop",
    "All-hands", "Backlog refinement", "Contract negotiation",
)


EVENT_CATEGORIES = weighted(vocabulary.EVENT_CATEGORY, (0.46, 0.16, 0.12, 0.09, 0.09, 0.08))


EVENT_STATUSES = weighted(vocabulary.EVENT_STATUS, (0.8, 0.14, 0.06))


EVENT_RESPONSES = weighted(vocabulary.EVENT_RESPONSE, (0.12, 0.62, 0.16, 0.1))


MEETING_ROOMS: tuple[str, ...] = (
    "Room Aurora (4)", "Room Basalt (8)", "Room Cinder (12)", "Room Dune (6)",
    "Microsoft Teams", "Google Meet", "Zoom", "Client site", "Remote",
)


EMAIL_SUBJECTS: tuple[str, ...] = (
    "Q3 reporting pack — review needed",
    "Renewal terms for the Northwind account",
    "Migration window confirmed for Saturday",
    "Follow-up: outstanding invoice 4471",
    "Access request for the reporting workspace",
    "Draft SOW for the integration project",
    "Incident summary — search latency",
    "Onboarding checklist for the new starters",
    "Contract redlines from legal",
    "Capacity plan for the next quarter",
    "Data retention policy — sign-off required",
    "Feedback on the new dashboard layout",
    "Vendor security questionnaire",
    "Change freeze over the release weekend",
    "Budget approval for additional storage",
    "Customer escalation — order 88132",
    "Weekly operations summary",
    "Proposal for the field service rollout",
)
