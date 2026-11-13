"""Seed data for catalog: JOB_ERRORS, SCHEDULED_TASKS, NAVIGATION_FLAGS."""

from __future__ import annotations

from src.core import vocabulary
from src.core.feature_catalogue import FEATURES as _CATALOGUE
from src.core.vocabulary import weighted

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


NAVIGATION_FLAGS: frozenset[str] = frozenset(f.key for f in _CATALOGUE if f.default_on)


#: (key, name, description, stage, experimental) — derived from the catalogue,
#: which is the single source of truth for what flags exist.
FEATURE_FLAGS: tuple[tuple[str, str, str, str, bool], ...] = tuple(
    (f.key, f.name, f.description, f.stage, f.experimental) for f in _CATALOGUE
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


#: Asserted against the vocabulary rather than trusted: a severity spelled
#: only here is one `/settings/security` cannot colour (§41).
assert {severity for _kind, severity, _title in SECURITY_EVENT_KINDS} <= set(
    vocabulary.SECURITY_SEVERITY
), "a seeded security event has a severity the vocabulary does not declare"
