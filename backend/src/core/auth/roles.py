"""The built-in roles, their default permissions, and the realm-role mapping."""

from __future__ import annotations

from typing import Any

from src.core.auth.permissions import ALL_PERMISSIONS

#: The five demo personas of §58, seeded into the `roles` table. Keycloak
#: carries the *membership*; these carry the meaning.
ROLE_DEFAULTS: dict[str, dict[str, Any]] = {
    "ADMINISTRATOR": {
        "name": "Administrator",
        "description": "Unrestricted access to every module and setting.",
        "rank": 100,
        "color": "#dc2626",
        "permissions": list(ALL_PERMISSIONS),
    },
    "MANAGER": {
        "name": "Manager",
        "description": "Manages teams, operational data and reporting.",
        "rank": 80,
        "color": "#7c3aed",
        "permissions": [
            "contracts.manage", "health.configure", "alerts.manage", "dashboards.publish", "records.restore",
            "chat.use", "docs.view", "docs.edit",
            "records.view", "records.create", "records.update", "records.export",
            "records.comment", "records.import", "records.bulk", "tags.manage",
            "users.view", "users.manage", "announcements.manage",
            "automations.manage",
            "jobs.view", "jobs.manage", "audit.view", "health.view", "logs.view",
            "tasks.view", "tasks.manage", "mail.access",
            "files.view", "files.manage", "calendar.view", "calendar.manage",
            "reports.view", "reports.manage", "dashboards.manage", "searches.share",
            "ai.use", "knowledge.manage",
            "time.track", "time.approve", "approvals.decide", "forms.manage",
        ],
    },
    "OPERATOR": {
        "name": "Operator",
        "description": "Works the operational record and task queues.",
        "rank": 60,
        "color": "#0891b2",
        "permissions": [
            "contracts.manage", "records.restore",
            "chat.use", "docs.view", "docs.edit",
            "records.view", "records.create", "records.update", "records.export",
            "records.comment",
            "users.view", "jobs.view", "health.view",
            "tasks.view", "tasks.manage", "mail.access",
            "files.view", "files.manage", "calendar.view", "calendar.manage",
            "reports.view", "dashboards.manage",
            "ai.use", "knowledge.manage",
            "time.track",
        ],
    },
    "ANALYST": {
        "name": "Analyst",
        "description": "Dashboards, reports, search and export. Reads, never writes.",
        "rank": 50,
        "color": "#16a34a",
        "permissions": [
            "alerts.manage", "dashboards.publish",
            "chat.use", "docs.view", "docs.edit",
            "records.view", "records.export",
            "users.view", "audit.view", "health.view", "jobs.view",
            "tasks.view", "files.view", "calendar.view",
            "reports.view", "reports.manage", "dashboards.manage", "searches.share",
            "ai.use", "knowledge.manage",
            "time.track",
        ],
    },
    "VIEWER": {
        "name": "Viewer",
        "description": "Read-only access to records, tasks and dashboards.",
        "rank": 20,
        "color": "#64748b",
        "permissions": [
            "chat.use", "docs.view",
            "records.view", "users.view", "tasks.view", "files.view",
            "calendar.view", "reports.view", "health.view", "mail.access",
            "ai.use",
            "time.track",
        ],
    },
}


#: Realm role name (lowercase, as Keycloak spells it) → platform role code.
REALM_ROLE_MAP: dict[str, str] = {
    "administrator": "ADMINISTRATOR",
    "admin": "ADMINISTRATOR",
    "manager": "MANAGER",
    "operator": "OPERATOR",
    "analyst": "ANALYST",
    "viewer": "VIEWER",
    "user": "VIEWER",
}


DEFAULT_ROLE_CODE = "VIEWER"
