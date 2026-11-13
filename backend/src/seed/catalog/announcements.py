"""Seed data for catalog: USER_AGENTS, API_PATHS, ALERT_RULES."""

from __future__ import annotations

from src.core import vocabulary
from src.core.auth import ALL_PERMISSIONS

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
