"""Seed data for catalog: EMAIL_PARAGRAPHS, EMAIL_LABELS, EMAIL_FOLDERS."""

from __future__ import annotations

from src.core import vocabulary
from src.core.vocabulary import weighted

EMAIL_PARAGRAPHS: tuple[str, ...] = (
    "Thanks for pulling this together. I have gone through the numbers and they "
    "line up with what finance sent over on Tuesday, with one exception noted below.",
    "Could you confirm whether this needs sign-off from the steering group before "
    "we proceed? I would rather ask now than unpick it afterwards.",
    "The window is confirmed. We will start at 22:00 and expect to be finished "
    "before 02:00; the service stays available throughout, read-only for the last hour.",
    "I have attached the revised version. The only substantive change is in section "
    "four, where the retention period moves from twelve to twenty-four months.",
    "This is now blocked on the vendor. I have chased twice and will escalate on "
    "Friday if there is still no response.",
    "Short version: it works, but it is slower than we would like above about two "
    "hundred concurrent users. Detail and numbers below.",
    "Happy to walk through this on a call if that is easier — I have time Thursday "
    "morning or any time Friday.",
    "Noting for the record that we agreed to defer the second phase until the "
    "budget for next year is confirmed.",
    "Please treat the figures as provisional until the reconciliation finishes "
    "tonight. I will send a corrected version if anything moves.",
    "The customer is understandably frustrated. I have offered a credit for the "
    "affected period and a call with the account team next week.",
)


EMAIL_LABELS: tuple[str, ...] = (
    "Finance", "Legal", "Customers", "Urgent", "Follow-up", "Internal",
    "Vendors", "Projects", "Reports", "Escalation",
)


EMAIL_FOLDERS = weighted(vocabulary.EMAIL_SEEDED_FOLDER, (0.58, 0.22, 0.12, 0.05, 0.03))


EMAIL_PRIORITIES = weighted(vocabulary.EMAIL_PRIORITY, (0.05, 0.82, 0.13))


EXTERNAL_DOMAINS: tuple[str, ...] = (
    "northwind-group.com", "contoso-systems.eu", "lakeside-logistics.nl",
    "ironwood-partners.co.uk", "brightpath-labs.io", "meridian-energy.de",
)


#: (extension, mime type, kind)
#: Only formats `seed/blobs.py` can genuinely write.
#:
#: A `.xlsx` whose bytes are plain text is not a spreadsheet: it looks fine in
#: a list and fails in the application the reader opens it with, which is worse
#: than not offering it. So `docx`, `xlsx`, `pptx`, `jpg` and `zip` are gone —
#: eight formats a reader can actually download beat twelve they cannot.
FILE_TYPES: tuple[tuple[str, str, str], ...] = (
    ("pdf", "application/pdf", "DOCUMENT"),
    ("md", "text/markdown", "DOCUMENT"),
    ("txt", "text/plain", "DOCUMENT"),
    ("csv", "text/csv", "SPREADSHEET"),
    ("json", "application/json", "DATA"),
    ("log", "text/plain", "LOG"),
    ("png", "image/png", "IMAGE"),
    ("svg", "image/svg+xml", "IMAGE"),
)


FILE_SUBJECTS: tuple[str, ...] = (
    "Statement of work", "Architecture overview", "Quarterly report",
    "Migration plan", "Security assessment", "Invoice", "Meeting notes",
    "Risk register", "Test results", "Budget forecast", "Runbook",
    "Data mapping", "Contract", "Release notes", "Capacity plan",
    "Incident report", "Onboarding guide", "Audit findings",
)


FOLDER_NAMES: tuple[str, ...] = (
    "Contracts", "Reports", "Design", "Engineering", "Finance", "Legal",
    "Customers", "Templates", "Archive", "Shared", "Onboarding", "Security",
)


#: (name, colour, category)
TAGS: tuple[tuple[str, str, str], ...] = (
    ("urgent", "#dc2626", "PRIORITY"), ("blocked", "#b91c1c", "STATUS"),
    ("customer-facing", "#7c3aed", "GENERAL"), ("internal", "#64748b", "GENERAL"),
    ("compliance", "#0891b2", "GOVERNANCE"), ("gdpr", "#0e7490", "GOVERNANCE"),
    ("security", "#be123c", "GOVERNANCE"), ("technical-debt", "#a16207", "ENGINEERING"),
    ("performance", "#ca8a04", "ENGINEERING"), ("migration", "#2563eb", "ENGINEERING"),
    ("automation", "#16a34a", "ENGINEERING"), ("documentation", "#059669", "GENERAL"),
    ("renewal", "#9333ea", "COMMERCIAL"), ("upsell", "#c026d3", "COMMERCIAL"),
    ("at-risk", "#ea580c", "STATUS"), ("quick-win", "#65a30d", "STATUS"),
    ("q3", "#475569", "PERIOD"), ("q4", "#334155", "PERIOD"),
    ("emea", "#0284c7", "REGION"), ("apac", "#0369a1", "REGION"),
)


COMMENT_BODIES: tuple[str, ...] = (
    "Picked this up — will have an update by end of day.",
    "This looks right to me. One question about the second column: is that "
    "figure inclusive of VAT?",
    "I have reassigned this to the platform team; it needs a change on their side first.",
    "Confirmed with the customer. They are happy to wait until the next release.",
    "Reopening — the same error came back this morning on a different account.",
    "Nice catch. I have raised a follow-up task so we do not lose the wider fix.",
    "Blocked until the vendor replies. Chasing again on Monday.",
    "Deployed to staging. Please have a look before we promote it.",
    "For the record, this was caused by the timezone change we made last week.",
    "Adding the compliance tag — we will need this in the next audit pack.",
    "Can we split this? The reporting part is much larger than the rest.",
    "Closing as duplicate of the ticket raised by the support team yesterday.",
)


LOG_MESSAGES: dict[str, tuple[str, ...]] = {
    "DEBUG": (
        "cache lookup miss for key {key}",
        "resolved {count} permissions for principal",
        "query planner chose an index scan",
        "session pool checked out connection {n}",
    ),
    "INFO": (
        "request completed in {ms}ms",
        "background job {ref} finished successfully",
        "user signed in from {ip}",
        "export produced {count} rows",
        "scheduled task {code} started",
        "feature flag {key} evaluated to true",
    ),
    "WARNING": (
        "slow query took {ms}ms",
        "retrying upstream call, attempt {n}",
        "cache unavailable, serving uncached",
        "rate limit reached for client {key}",
        "deprecated parameter used on {path}",
    ),
    "ERROR": (
        "failed to deliver notification: connection reset",
        "import row {n} rejected: mandatory field missing",
        "upstream returned 502 after {n} retries",
        "database statement timeout after {ms}ms",
        "invalid token signature from {ip}",
    ),
    "CRITICAL": (
        "connection pool exhausted, refusing requests",
        "disk usage above 95% on {host}",
    ),
}


LOG_LEVELS = weighted(vocabulary.LOG_LEVEL, (0.24, 0.5, 0.16, 0.085, 0.015))


LOGGERS: tuple[str, ...] = (
    "src.api.entities", "src.api.records.search", "src.api.admin", "src.core.auth",
    "src.core.query", "src.core.cache", "src.services.export",
    "src.services.import", "src.services.collaboration.notifications", "gunicorn.access",
)


# INGEST jobs belong to a document being read (§44); the seed makes those
# with the documents rather than at random.
JOB_KINDS = weighted(vocabulary.JOB_KIND, (0.28, 0.16, 0.14, 0.12, 0.12, 0.1, 0.08, 0.0))


#: Weighted in the vocabulary's order (QUEUED, RUNNING, RETRYING, SUCCEEDED,
#: FAILED, CANCELLED), not in the order a dashboard would list them — the
#: positional pairing is what makes a new state fail loudly instead of
#: silently never being generated.
JOB_STATUSES = weighted(vocabulary.JOB_STATUS, (0.12, 0.08, 0.04, 0.6, 0.11, 0.05))
