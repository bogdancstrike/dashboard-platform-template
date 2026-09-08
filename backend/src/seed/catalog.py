"""The vocabularies the seed draws from.

Plain data, kept apart from the builders so the shape of the dataset and the
words in it can change independently. Two rules held throughout:

* **Nothing is lorem ipsum.** A ticket called "Lorem ipsum dolor" tells you
  nothing about whether the ticket list is readable at 240 characters, and a
  demo full of placeholder text is a demo nobody can evaluate.
* **Every list is long enough not to repeat obviously.** 150 users drawn from
  20 first names look like a bug, not a company.
"""

from __future__ import annotations

from src.core import geography, vocabulary
from src.core.auth import ALL_PERMISSIONS
from src.core.vocabulary import weighted

# The closed value sets live in `core/vocabulary.py`, shared with the query
# builder and the API. Here they are given the distribution the seed draws
# from — positionally, so a value added there without a weight fails loudly
# instead of quietly never being generated.

# ── people ───────────────────────────────────────────────────────────────

FIRST_NAMES: tuple[str, ...] = (
    "Ana", "Mihai", "Elena", "Andrei", "Ioana", "Radu", "Maria", "Cristian",
    "Diana", "Alexandru", "Raluca", "Bogdan", "Simona", "Vlad", "Gabriela",
    "Sorin", "Carmen", "Tudor", "Irina", "Cătălin", "Alina", "Marius",
    "Roxana", "Ștefan", "Laura", "Adrian", "Monica", "Paul", "Andreea",
    "Emil", "Sofia", "Lucian", "Bianca", "Victor", "Corina", "Dan",
    "Lucas", "Emma", "Noah", "Olivia", "Liam", "Mia", "Jonas", "Freya",
    "Mateo", "Chiara", "Nils", "Astrid", "Pablo", "Ingrid", "Youssef",
    "Amara", "Kenji", "Sana", "Dmitri", "Zofia", "Bram", "Eline",
    "Tomás", "Aoife", "Rasmus", "Sigrid", "Milan", "Lena", "Aleksander",
    "Nadia", "Hugo", "Clara", "Felix", "Nora", "Otto", "Ilse",
)

LAST_NAMES: tuple[str, ...] = (
    "Popescu", "Ionescu", "Dumitrescu", "Georgescu", "Stoica", "Marin",
    "Constantin", "Radu", "Munteanu", "Ciobanu", "Nistor", "Barbu",
    "Stanciu", "Șerban", "Diaconu", "Vasilescu", "Petrescu", "Tudose",
    "Novak", "Kovács", "Horvat", "Nowak", "Kowalski", "Schneider",
    "Müller", "Fischer", "Weber", "Hoffmann", "Bakker", "de Vries",
    "Jansen", "Larsen", "Nielsen", "Andersson", "Lindqvist", "Virtanen",
    "Silva", "Costa", "Ferreira", "Rossi", "Bianchi", "Esposito",
    "García", "Martínez", "López", "Moreau", "Lefèvre", "Dubois",
    "O'Sullivan", "Byrne", "Walsh", "Novotný", "Dvořák", "Marek",
    "Aslan", "Yılmaz", "Haddad", "Okafor", "Mensah", "Tanaka",
)

JOB_TITLES: dict[str, tuple[str, ...]] = {
    "Engineering": (
        "Software Engineer", "Senior Software Engineer", "Staff Engineer",
        "Engineering Manager", "Platform Engineer", "QA Engineer",
        "Site Reliability Engineer", "Data Engineer", "Frontend Engineer",
    ),
    "Product": ("Product Manager", "Senior Product Manager", "Product Owner", "Product Analyst"),
    "Design": ("Product Designer", "UX Researcher", "Design Lead", "Content Designer"),
    "Sales": ("Account Executive", "Sales Manager", "Sales Development Rep", "Solutions Engineer"),
    "Marketing": ("Marketing Manager", "Content Strategist", "Growth Analyst", "Brand Manager"),
    "Support": ("Support Specialist", "Support Team Lead", "Technical Support Engineer"),
    "Finance": ("Financial Analyst", "Controller", "Accounts Manager", "Procurement Specialist"),
    "People": ("People Partner", "Recruiter", "People Operations Manager"),
    "Operations": ("Operations Manager", "Business Analyst", "Programme Manager"),
    "Legal": ("Legal Counsel", "Compliance Officer", "Data Protection Officer"),
    "Security": ("Security Engineer", "Security Analyst", "Head of Security"),
    "Executive": ("Chief Executive Officer", "Chief Technology Officer", "Chief Financial Officer"),
}

DEPARTMENTS: tuple[tuple[str, str], ...] = (
    ("Engineering", "ENG"), ("Product", "PRD"), ("Design", "DSG"),
    ("Sales", "SLS"), ("Marketing", "MKT"), ("Support", "SUP"),
    ("Finance", "FIN"), ("People", "HR"), ("Operations", "OPS"),
    ("Legal", "LGL"), ("Security", "SEC"), ("Executive", "EXE"),
)

#: Sub-departments, so the hierarchical selector (§9) has real depth.
SUB_DEPARTMENTS: dict[str, tuple[str, ...]] = {
    "Engineering": ("Platform", "Applications", "Infrastructure", "Quality"),
    "Sales": ("Enterprise", "Mid-Market", "Partnerships"),
    "Support": ("Tier 1", "Tier 2", "Customer Success"),
    "Operations": ("Logistics", "Facilities"),
    "Finance": ("Accounting", "Procurement"),
}

TEAM_NAMES: tuple[str, ...] = (
    "Atlas", "Beacon", "Cobalt", "Delta", "Ember", "Foundry", "Granite",
    "Harbour", "Ionic", "Juniper", "Keystone", "Lantern", "Meridian",
    "Northstar", "Orbit", "Pioneer", "Quarry", "Redwood", "Summit",
    "Tidal", "Umbra", "Vertex", "Wayfinder", "Zenith",
)

# ── organizations ────────────────────────────────────────────────────────

ORG_ROOTS: tuple[str, ...] = (
    "Northwind", "Contoso", "Lakeside", "Ironwood", "Brightpath", "Cobalt",
    "Everline", "Fairmont", "Greenfield", "Halcyon", "Ridgeway", "Stonebridge",
    "Trailhead", "Vanguard", "Westbrook", "Kestrel", "Marlow", "Oakhaven",
    "Pinecrest", "Quicksilver", "Riverstone", "Silverline", "Thornbury",
)

ORG_SUFFIXES: tuple[str, ...] = (
    "Group", "Holdings", "Industries", "Systems", "Logistics", "Analytics",
    "Technologies", "Partners", "Solutions", "Networks", "Labs", "Works",
)

INDUSTRIES: tuple[str, ...] = (
    "Manufacturing", "Financial Services", "Healthcare", "Retail",
    "Logistics", "Energy", "Telecommunications", "Public Sector",
    "Education", "Insurance", "Construction", "Agriculture",
    "Media", "Hospitality", "Pharmaceuticals", "Automotive",
)

#: Weighted in the vocabulary's order — smallest tier first — so a tier added
#: there fails loudly here instead of silently never being generated.
ORG_TIERS = weighted(vocabulary.ORG_TIER, (0.05, 0.25, 0.5, 0.2))

#: (name, code, timezone, currency) — derived from the gazetteer, so a region
#: the seed creates is a region the map can name.
REGIONS: tuple[tuple[str, str, str, str], ...] = tuple(
    (region.name, region.code, region.timezone, region.currency)
    for region in geography.REGIONS
)

#: (city, country, region code) — derived from the gazetteer rather than
#: written twice. A city that can be seeded is therefore a city the map can
#: place; two lists would be a map with holes in it the first time anybody
#: added a city to one of them.
LOCATIONS: tuple[tuple[str, str, str], ...] = tuple(
    (place.city, place.country, place.region) for place in geography.PLACES
)


# ── projects, work and customers ─────────────────────────────────────────

PROJECT_ADJECTIVES: tuple[str, ...] = (
    "Unified", "Next-Generation", "Automated", "Consolidated", "Federated",
    "Realtime", "Self-Service", "Regional", "Modular", "Zero-Touch",
    "Predictive", "Streamlined", "Integrated", "Resilient", "Cross-Border",
)

PROJECT_SUBJECTS: tuple[str, ...] = (
    "Billing Platform", "Customer Portal", "Warehouse Automation",
    "Data Lakehouse", "Identity Migration", "Field Service App",
    "Partner Onboarding", "Fraud Detection", "Supply Chain Visibility",
    "Payment Orchestration", "Document Archive", "Reporting Suite",
    "Contact Centre", "Asset Registry", "Compliance Programme",
    "Network Modernisation", "Employee Intranet", "Sales Enablement",
    "Inventory Forecasting", "Quality Management",
)

PROJECT_STATUSES = weighted(vocabulary.PROJECT_STATUS, (0.45, 0.15, 0.1, 0.22, 0.05, 0.03))
PROJECT_PHASES = vocabulary.PROJECT_PHASE
PROJECT_HEALTH = weighted(vocabulary.PROJECT_HEALTH, (0.62, 0.24, 0.14))

PRIORITIES = weighted(vocabulary.PRIORITY, (0.2, 0.45, 0.25, 0.1))

TASK_VERBS: tuple[str, ...] = (
    "Migrate", "Refactor", "Document", "Investigate", "Automate", "Review",
    "Roll out", "Harden", "Benchmark", "Decommission", "Instrument",
    "Consolidate", "Validate", "Escalate", "Reconcile", "Draft", "Audit",
)

TASK_OBJECTS: tuple[str, ...] = (
    "the invoicing service", "the onboarding flow", "the nightly export",
    "the permission matrix", "the search index", "the audit retention job",
    "the customer import", "the alerting rules", "the staging database",
    "the API rate limits", "the notification templates", "the backup schedule",
    "the SSO configuration", "the reporting pipeline", "the file storage tier",
    "the device firmware rollout", "the quarterly reconciliation",
    "the incident runbook", "the data retention policy", "the pricing table",
)

TASK_STATUSES = weighted(vocabulary.TASK_STATUS, (0.16, 0.14, 0.22, 0.07, 0.11, 0.26, 0.04))
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

# ── devices ──────────────────────────────────────────────────────────────

DEVICE_MANUFACTURERS: tuple[str, ...] = (
    "Aeris", "Bolder", "Cygnus", "Dynamo", "Elpis", "Fluxtron", "Halberd",
)
DEVICE_KINDS = weighted(vocabulary.DEVICE_KIND, (0.38, 0.18, 0.14, 0.12, 0.12, 0.06))
DEVICE_STATUSES = weighted(vocabulary.DEVICE_STATUS, (0.66, 0.14, 0.09, 0.07, 0.04))

# ── calendar ─────────────────────────────────────────────────────────────

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

# ── mail ─────────────────────────────────────────────────────────────────

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

# ── files ────────────────────────────────────────────────────────────────

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

# ── tags ─────────────────────────────────────────────────────────────────

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

# ── comments ─────────────────────────────────────────────────────────────

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

# ── platform operations ──────────────────────────────────────────────────

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
    "src.api.entities", "src.api.search", "src.api.admin", "src.core.auth",
    "src.core.query", "src.core.cache", "src.services.export",
    "src.services.import", "src.services.notifications", "gunicorn.access",
)

JOB_KINDS = weighted(vocabulary.JOB_KIND, (0.28, 0.16, 0.14, 0.12, 0.12, 0.1, 0.08))
#: Weighted in the vocabulary's order (QUEUED, RUNNING, RETRYING, SUCCEEDED,
#: FAILED, CANCELLED), not in the order a dashboard would list them — the
#: positional pairing is what makes a new state fail loudly instead of
#: silently never being generated.
JOB_STATUSES = weighted(vocabulary.JOB_STATUS, (0.12, 0.08, 0.04, 0.6, 0.11, 0.05))
JOB_ERRORS: tuple[str, ...] = (
    "Upstream timed out after 30s",
    "Row 412: customer code does not exist",
    "Permission denied writing to the export volume",
    "Connection reset by the mail relay",
    "Statement timeout while aggregating orders",
)

#: (code, name, cron, kind)
SCHEDULED_TASKS: tuple[tuple[str, str, str, str], ...] = (
    ("nightly-export", "Nightly data export", "0 2 * * *", "EXPORT"),
    ("audit-retention", "Audit log retention sweep", "30 3 * * 0", "MAINTENANCE"),
    ("session-cleanup", "Expire stale sessions", "*/15 * * * *", "MAINTENANCE"),
    ("digest-email", "Daily notification digest", "0 7 * * 1-5", "EMAIL"),
    ("search-reindex", "Rebuild the search index", "0 4 * * *", "REINDEX"),
    ("kpi-rollup", "Dashboard KPI roll-up", "*/10 * * * *", "REPORT"),
    ("invoice-sync", "Sync invoices from finance", "0 */6 * * *", "SYNC"),
    ("device-health", "Poll device health", "*/5 * * * *", "SYNC"),
    ("storage-sweep", "Reclaim orphaned files", "0 1 * * 6", "MAINTENANCE"),
    ("alert-evaluation", "Evaluate alert rules", "*/15 * * * *", "MAINTENANCE"),
)

#: (key, name, description, stage, experimental)
FEATURE_FLAGS: tuple[tuple[str, str, str, str, bool], ...] = (
    ("advanced-search", "Advanced search builder", "Nested condition builder on list pages.", "GA", False),
    ("dashboard-builder", "Dashboard builder", "Let users compose their own dashboards.", "BETA", False),
    ("dark-mode", "Dark mode", "Dark colour scheme across the application.", "GA", False),
    ("bulk-operations", "Bulk operations", "Multi-select actions on list pages.", "GA", False),
    ("csv-import", "CSV import wizard", "Guided import with column mapping.", "BETA", False),
    ("saved-views", "Saved views", "Persist filters, columns and density per user.", "GA", False),
    ("command-palette", "Command palette", "Keyboard-driven navigation.", "BETA", False),
    ("live-log-stream", "Live log stream", "Tail system logs in the browser.", "ALPHA", True),
    ("ai-summaries", "AI record summaries", "Generated summaries on detail pages.", "ALPHA", True),
    ("kanban-board", "Kanban board", "Drag-and-drop task board.", "GA", False),
    ("impersonation", "User impersonation", "Administrators may act as another user.", "BETA", False),
    ("webhooks", "Outbound webhooks", "Publish domain events to external systems.", "ALPHA", True),
    ("report-scheduling", "Scheduled reports", "Email a report on a cron schedule.", "BETA", False),
    ("mobile-layout", "Mobile layout", "Responsive layout below 768px.", "GA", False),
)

#: (key, name, provider, category, icon). The categories are asserted against
#: the vocabulary below rather than trusted — one spelled only here is one the
#: page's filter cannot offer.
INTEGRATIONS: tuple[tuple[str, str, str, str, str], ...] = (
    ("slack", "Slack", "Slack", "MESSAGING", "message"),
    ("teams", "Microsoft Teams", "Microsoft", "MESSAGING", "message"),
    ("jira", "Jira", "Atlassian", "ISSUE_TRACKING", "bug"),
    ("github", "GitHub", "GitHub", "SOURCE_CONTROL", "code"),
    ("salesforce", "Salesforce", "Salesforce", "CRM", "briefcase"),
    ("hubspot", "HubSpot", "HubSpot", "CRM", "briefcase"),
    ("stripe", "Stripe", "Stripe", "PAYMENTS", "credit-card"),
    ("sendgrid", "SendGrid", "Twilio", "EMAIL", "mail"),
    ("s3", "Amazon S3", "AWS", "STORAGE", "database"),
    ("snowflake", "Snowflake", "Snowflake", "ANALYTICS", "bar-chart"),
    ("pagerduty", "PagerDuty", "PagerDuty", "ALERTING", "bell"),
    ("okta", "Okta", "Okta", "IDENTITY", "shield"),
)

assert {category for _, _, _, category, _ in INTEGRATIONS} <= set(
    vocabulary.INTEGRATION_CATEGORY
), "a seeded integration has a category the vocabulary does not declare"

#: (key, name, category)
MONITORED_SERVICES: tuple[tuple[str, str, str], ...] = (
    ("database", "PostgreSQL", "DATASTORE"),
    ("cache", "Redis", "DATASTORE"),
    ("identity", "Keycloak", "IDENTITY"),
    ("storage", "Object storage", "STORAGE"),
    ("mail", "Mail relay", "EMAIL"),
    ("search", "Search index", "SERVICE"),
    ("jobs", "Job runner", "SERVICE"),
    ("api", "Public API", "SERVICE"),
)

#: (key, category, label, type, default, description, options).
#:
#: The **options** are the seventh field because they are what the settings
#: form renders from: a `choice` gets a select, an `integer` with a range gets
#: a bounded number. `secret` and `restart` live here too — both are facts
#: about a setting, and deriving them from a key prefix (which the seed did,
#: with a coin flip on top) meant two places disagreeing about which settings
#: need a restart. The first version left options empty and put the choices in
#: the *description* — "compact, middle or comfortable" — which made every
#: setting a text box and the declared type decoration. A description that
#: lists the valid values is a type that has not been declared.
SYSTEM_SETTINGS: tuple[tuple[str, str, str, str, object, str, dict], ...] = (
    ("app.name", "general", "Application name", "string", "Nucleus",
     "Shown in the header and on emails.", {}),
    ("app.support_email", "general", "Support email", "string", "support@nucleus.local",
     "Where the help menu points.", {}),
    ("app.default_locale", "general", "Default locale", "choice", "en-US",
     "Used until a user chooses their own.",
     {"choices": ["en-US", "en-GB", "de-DE", "fr-FR", "ro-RO"]}),
    ("app.default_timezone", "general", "Default timezone", "choice", "UTC",
     "Used for display and scheduling.",
     {"choices": ["UTC", "Europe/London", "Europe/Bucharest", "Europe/Berlin", "America/New_York"]}),
    ("ui.density", "appearance", "Default table density", "choice", "middle",
     "Until a person chooses their own.", {"choices": ["compact", "middle", "comfortable"]}),
    ("ui.page_size", "appearance", "Default page size", "choice", 25,
     "Rows per page on list screens.", {"choices": [10, 25, 50, 100]}),
    ("ui.theme", "appearance", "Default theme", "choice", "system",
     "Until a person chooses their own.", {"choices": ["light", "dark", "system"]}),
    ("security.session_timeout_minutes", "security", "Session timeout", "duration", 60,
     "Idle minutes before sign-out.",
     {"minimum": 5, "maximum": 1440, "unit": "minutes", "restart": True}),
    ("security.mfa_required", "security", "Require MFA", "boolean", False,
     "Force two-factor for every user.", {}),
    ("security.password_min_length", "security", "Minimum password length", "integer", 12,
     "Enforced by the identity provider.", {"minimum": 8, "maximum": 128}),
    ("security.max_failed_logins", "security", "Failed sign-in limit", "integer", 5,
     "Attempts before an account locks.", {"minimum": 1, "maximum": 100}),
    # The one secret, so the settings screen demonstrates that it never sends
    # one: a page that renders an API key puts it in a screenshot, a browser
    # cache and a support ticket.
    ("integrations.webhook_signing_key", "security", "Webhook signing key", "string",
     "whsec_replace_me",
     "Signs outbound webhooks. Never displayed once set.",
     {"secret": True, "restart": True}),
    ("retention.audit_days", "retention", "Audit retention", "duration", 730,
     "Days an audit entry is kept.", {"minimum": 30, "maximum": 3650, "unit": "days"}),
    ("retention.log_days", "retention", "Log retention", "duration", 30,
     "Days a system log line is kept.", {"minimum": 1, "maximum": 365, "unit": "days"}),
    ("retention.notification_days", "retention", "Notification retention", "duration", 90,
     "Days a read notification is kept.", {"minimum": 7, "maximum": 730, "unit": "days"}),
    # An export artefact is a copy of production rows sitting in object
    # storage, so it has the shortest window here by some distance (§30).
    ("retention.export_days", "retention", "Export retention", "duration", 7,
     "Days a finished export's file is kept for download.",
     {"minimum": 1, "maximum": 90, "unit": "days"}),
    ("limits.max_upload_mb", "limits", "Maximum upload size", "integer", 25,
     "Per-file limit, in megabytes.",
     {"minimum": 1, "maximum": 1024, "unit": "MB", "restart": True}),
    ("limits.max_export_rows", "limits", "Maximum export rows", "integer", 100000,
     "Above this an export becomes a job.", {"minimum": 1000, "maximum": 5000000}),
    ("limits.api_rate_per_minute", "limits", "API rate limit", "integer", 600,
     "Requests per minute per client.",
     {"minimum": 10, "maximum": 100000, "restart": True}),
    ("notifications.digest_hour", "notifications", "Digest hour", "integer", 7,
     "Local hour the daily digest is sent.", {"minimum": 0, "maximum": 23}),
    ("notifications.email_enabled", "notifications", "Email notifications", "boolean", True,
     "Send notifications by email.", {}),
    ("features.self_service_signup", "features", "Self-service sign-up", "boolean", False,
     "Allow registration without an invite.", {}),
)

NOTIFICATION_CATEGORIES = vocabulary.NOTIFICATION_CATEGORY

#: One icon per category, keyed by the vocabulary so a category added there
#: without an icon fails *here* rather than raising a `KeyError` in the middle
#: of a seed run — which is what happened when `ALERT` was added.
NOTIFICATION_ICONS: dict[str, str] = {
    "MENTION": "at",
    "ASSIGNMENT": "user-check",
    "APPROVAL": "check-circle",
    "ALERT": "bell",
    "SYSTEM": "settings",
    "SECURITY": "shield",
    "REPORT": "bar-chart",
}
assert set(NOTIFICATION_ICONS) == set(vocabulary.NOTIFICATION_CATEGORY), (
    "every notification category needs an icon: "
    f"{sorted(set(vocabulary.NOTIFICATION_CATEGORY) - set(NOTIFICATION_ICONS))} missing"
)
NOTIFICATION_SEVERITIES = weighted(vocabulary.NOTIFICATION_SEVERITY, (0.72, 0.2, 0.08))

SECURITY_EVENT_KINDS: tuple[tuple[str, str, str], ...] = (
    ("NEW_DEVICE_SIGN_IN", "INFO", "Sign-in from a new device"),
    ("PASSWORD_CHANGED", "INFO", "Password changed"),
    ("MFA_ENABLED", "INFO", "Two-factor authentication enabled"),
    ("MFA_DISABLED", "WARNING", "Two-factor authentication disabled"),
    ("FAILED_LOGIN_BURST", "WARNING", "Several failed sign-in attempts"),
    ("PERMISSION_ESCALATION", "WARNING", "Role changed to a higher privilege"),
    ("SESSION_REVOKED", "INFO", "Session revoked by an administrator"),
    ("IMPOSSIBLE_TRAVEL", "CRITICAL", "Sign-ins from distant locations in a short window"),
    ("API_KEY_CREATED", "INFO", "API credential created"),
    ("API_KEY_REVOKED", "WARNING", "API credential revoked"),
)

USER_AGENTS: tuple[str, ...] = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
    "Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
    "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0 Safari/537.36 Edg/139.0",
)

API_PATHS: tuple[str, ...] = (
    "/platform/entities/project/records",
    "/platform/entities/customer/records",
    "/platform/entities/order/records",
    "/platform/entities/ticket/records",
    "/platform/dashboard/kpis",
    "/platform/search/advanced",
    "/platform/admin/users",
    "/platform/reports/run",
    "/platform/files",
    "/platform/tasks",
)

#: (name, resource type, severity)
ALERT_RULES: tuple[tuple[str, str, str], ...] = (
    ("Overdue critical tasks", "task", "CRITICAL"),
    ("SLA breach imminent", "ticket", "WARNING"),
    ("Orders stuck in fulfilment", "order", "WARNING"),
    ("Devices offline over 24h", "device", "WARNING"),
    ("Projects trending off track", "project", "WARNING"),
    ("Customers with no contact in 90 days", "customer", "INFO"),
    ("Failed jobs in the last hour", "job", "CRITICAL"),
    ("Unusual sign-in volume", "user", "CRITICAL"),
    ("Storage quota above 85%", "file", "WARNING"),
    ("Invoices overdue beyond 30 days", "order", "CRITICAL"),
)

#: (code, name, category, subject)
EMAIL_TEMPLATES: tuple[tuple[str, str, str, str], ...] = (
    ("welcome", "Welcome email", "TRANSACTIONAL", "Welcome to {{app_name}}"),
    ("password-reset", "Password reset", "TRANSACTIONAL", "Reset your {{app_name}} password"),
    ("task-assigned", "Task assigned", "NOTIFICATION", "{{actor}} assigned you {{task}}"),
    ("mention", "Mention", "NOTIFICATION", "{{actor}} mentioned you in {{resource}}"),
    ("digest", "Daily digest", "NOTIFICATION", "Your {{app_name}} digest for {{date}}"),
    ("export-ready", "Export ready", "NOTIFICATION", "Your export of {{entity}} is ready"),
    ("invite", "User invitation", "TRANSACTIONAL", "{{actor}} invited you to {{app_name}}"),
    ("sla-breach", "SLA breach", "ALERT", "SLA breached on {{reference}}"),
    ("invoice-due", "Invoice due", "COMMERCIAL", "Invoice {{reference}} is due on {{date}}"),
    ("renewal", "Renewal reminder", "COMMERCIAL", "{{customer}} renews on {{date}}"),
    ("incident", "Incident notice", "ALERT", "Incident: {{title}}"),
    ("report-ready", "Scheduled report", "NOTIFICATION", "{{report}} for {{period}}"),
)

#: (name, kind, permissions granted on top of the role)
#: (name, kind, permissions it grants).
#:
#: The kinds are asserted against the vocabulary below rather than trusted:
#: these were literals, and a kind spelled only here is one `/admin/groups`
#: cannot filter by.
GROUPS: tuple[tuple[str, str, tuple[str, ...]], ...] = (
    ("On-call", "OPERATIONAL", ("jobs.manage", "logs.view", "health.view")),
    ("Release managers", "OPERATIONAL", ("flags.manage", "jobs.manage")),
    ("Data stewards", "GOVERNANCE", ("records.export", "records.import", "audit.view")),
    ("Security reviewers", "GOVERNANCE", ("audit.view", "logs.view", "api.manage")),
    ("Finance approvers", "BUSINESS", ("reports.manage", "records.export")),
    ("Customer success", "BUSINESS", ("records.update", "mail.access")),
    ("Project leads", "TEAM", ("tasks.manage", "dashboards.manage")),
    ("Integration owners", "OPERATIONAL", ("integrations.manage", "api.manage")),
    ("Report authors", "BUSINESS", ("reports.manage", "searches.share")),
    ("Onboarding buddies", "TEAM", ("users.view",)),
)

assert {kind for _, kind, _ in GROUPS} <= set(vocabulary.GROUP_KIND), (
    "a seeded group has a kind the vocabulary does not declare"
)
assert all(
    set(permissions) <= set(ALL_PERMISSIONS) for _, _, permissions in GROUPS
), "a seeded group grants a permission no endpoint checks for"

DASHBOARD_WIDGETS: tuple[tuple[str, str, str], ...] = (
    ("KPI", "Open tickets", "ticket"),
    ("KPI", "Active projects", "project"),
    ("KPI", "Revenue this month", "order"),
    ("KPI", "Tasks due this week", "task"),
    ("LINE_CHART", "Orders over time", "order"),
    ("BAR_CHART", "Tickets by category", "ticket"),
    ("PIE_CHART", "Projects by health", "project"),
    ("TABLE", "Recently updated records", "project"),
    ("LIST", "My open tasks", "task"),
    ("ACTIVITY", "Recent activity", "activity"),
    ("ALERTS", "Active alerts", "alert"),
    ("AREA_CHART", "Revenue by region", "order"),
    ("GAUGE", "SLA compliance", "ticket"),
    ("HEATMAP", "Activity by day", "activity"),
)

#: Announcements, as the platform would actually word them (§17).
#:
#: `(title, category, severity, body)`. Written out rather than generated
#: because a notice is *prose* — a maintenance window assembled from a template
#: reads like one, and a demo dataset whose announcements are obviously
#: machine-made is a demo of the wrong thing.
ANNOUNCEMENTS: tuple[tuple[str, str, str, str], ...] = (
    (
        "Scheduled maintenance this Sunday, 02:00–04:00 UTC",
        "MAINTENANCE", "WARNING",
        "The platform will be read-only for up to two hours while the primary "
        "database is upgraded. Exports queued during the window will run "
        "afterwards; nothing needs to be re-submitted.",
    ),
    (
        "Release 2.4 — saved dashboards and the map view",
        "RELEASE", "INFO",
        "Dashboards can now be shared the way saved searches are, and every "
        "dataset that reaches a place can be drawn on the map. See the release "
        "notes for the full list.",
    ),
    (
        "Single sign-on is now required for every account",
        "POLICY", "CRITICAL",
        "Password sign-in has been disabled. If you have a service account "
        "that still authenticates with a password, move it to an API "
        "credential before the end of the month.",
    ),
    (
        "Degraded search performance, 09:12–10:40 UTC",
        "INCIDENT", "WARNING",
        "Global search returned slowly or timed out for about ninety minutes "
        "this morning. The cause was an unindexed query on the activity feed; "
        "it has been fixed and search is back to normal.",
    ),
    (
        "New export limits",
        "POLICY", "INFO",
        "Exports are capped at 250 000 rows. Anything larger is queued as a "
        "background job and delivered as a download link.",
    ),
    (
        "Welcome to the new reporting workspace",
        "NEWS", "INFO",
        "Reports and charts are now built from one question. Anything you had "
        "saved still opens; the builder simply asks for it in fewer places.",
    ),
    (
        "Certificate rotation on the API gateway",
        "MAINTENANCE", "INFO",
        "The TLS certificate will be replaced on Thursday. Clients that pin "
        "the old fingerprint will need to be updated.",
    ),
    (
        "Quarterly access review starts Monday",
        "POLICY", "WARNING",
        "Every manager will be asked to confirm the permissions their team "
        "holds. Nothing is revoked automatically, but unreviewed access is "
        "reported to the security group.",
    ),
    (
        "Read-only replica now serves reports",
        "RELEASE", "INFO",
        "Long-running reports are answered by a replica, so a heavy analysis "
        "no longer slows the record pages down.",
    ),
    (
        "Data retention: audit entries older than two years",
        "POLICY", "INFO",
        "Audit entries are now archived after twenty-four months rather than "
        "kept indefinitely. Archived entries remain retrievable on request.",
    ),
)

REPORT_NAMES: tuple[tuple[str, str, str], ...] = (
    ("Revenue by region", "order", "bar"),
    ("Ticket volume by category", "ticket", "line"),
    ("Project health overview", "project", "pie"),
    ("Task throughput by team", "task", "bar"),
    ("Customer lifetime value", "customer", "table"),
    ("Orders by channel", "order", "pie"),
    ("SLA compliance trend", "ticket", "line"),
    ("Device uptime by site", "device", "bar"),
    ("Storage growth", "file", "area"),
    ("Sign-in activity", "user", "line"),
)

#: Kanban boards, and the epics on each (§18).
#:
#: `(board name, key, [(epic, [story, ...]), ...])`. Written out because a
#: board is a *plan*: an epic called "Epic 3" with a story called "Story 7"
#: under it demonstrates a hierarchy and nothing about why anybody would use
#: one. These read like work somebody is actually doing.
KANBAN_BOARDS: tuple[tuple[str, str, tuple[tuple[str, tuple[str, ...]], ...]], ...] = (
    (
        "Platform delivery", "PLAT",
        (
            (
                "Self-service reporting",
                (
                    "Save a chart from the builder",
                    "Share a report with named colleagues",
                    "Schedule a report to arrive on Monday",
                ),
            ),
            (
                "Single sign-on rollout",
                (
                    "Map Keycloak groups to platform roles",
                    "Retire password sign-in for service accounts",
                    "Document the break-glass procedure",
                ),
            ),
            (
                "Performance of the record pages",
                (
                    "Index the activity feed's resource lookup",
                    "Stream exports instead of buffering them",
                ),
            ),
        ),
    ),
    (
        "Support improvements", "SUP",
        (
            (
                "First-response time",
                (
                    "Route tickets by category on arrival",
                    "Alert on a ticket nobody has answered in an hour",
                ),
            ),
            (
                "Customer self-service",
                (
                    "Publish the status page",
                    "Let a customer reopen their own ticket",
                ),
            ),
        ),
    ),
    (
        "Field operations", "FIELD",
        (
            (
                "Device fleet visibility",
                (
                    "Report battery health per site",
                    "Flag a gateway that has not checked in",
                ),
            ),
            (
                "Installer handbook",
                ("Photograph every cabinet layout", "Write the commissioning checklist"),
            ),
        ),
    ),
    (
        "Onboarding", "ONB",
        (
            (
                "First week that works",
                (
                    "Pre-create the accounts a new starter needs",
                    "One page that says where everything is",
                ),
            ),
        ),
    ),
)

#: The tasks and bugs a story is broken into. Generic on purpose — these are
#: the small pieces, and their titles are the same shape whatever the story.
KANBAN_PIECES: tuple[tuple[str, str], ...] = (
    ("TASK", "Design the change"),
    ("TASK", "Write it"),
    ("TASK", "Cover it with tests"),
    ("TASK", "Update the documentation"),
    ("BUG", "Fix the edge case found in review"),
    ("TASK", "Roll it out behind a flag"),
)

KANBAN_LABELS: tuple[str, ...] = (
    "backend", "frontend", "infrastructure", "documentation",
    "customer-request", "tech-debt", "security", "accessibility",
)

SAVED_SEARCH_NAMES: tuple[tuple[str, str], ...] = (
    ("My overdue tasks", "task"),
    ("Critical open tickets", "ticket"),
    ("Enterprise customers at risk", "customer"),
    ("Projects off track", "project"),
    ("Unpaid orders over 30 days", "order"),
    ("Devices offline this week", "device"),
    ("High-value orders this quarter", "order"),
    ("Tickets breaching SLA", "ticket"),
    ("Recently churned customers", "customer"),
    ("Blocked tasks", "task"),
)

SAVED_VIEW_NAMES: tuple[tuple[str, str], ...] = (
    ("Operations board", "task"),
    ("Account manager view", "customer"),
    ("Finance review", "order"),
    ("Support triage", "ticket"),
    ("Portfolio overview", "project"),
    ("Field devices", "device"),
)
