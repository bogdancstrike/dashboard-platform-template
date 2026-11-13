"""Platform operations: audit, activity, logs, jobs, flags, API, integrations."""

from __future__ import annotations

from src.core.facade import lazy

__getattr__, __dir__, __all__ = lazy(__name__, {
    "scheduled_tasks": ("AUDIT_ACTIONS", "_scheduled_tasks", "_role_code"),
    "announcements": ("_announcements",),
    "integrations": ("_integrations", "_change_for"),
    "audit_and_activity": ("_health_series", "_audit_and_activity"),
    "api_clients": ("_service_health", "_api_clients"),
    "system_logs": ("_system_settings", "_system_logs"),
    "notification_for": ("_feature_flags", "_notifications", "_notification_for"),
    "import_errors": ("_import_columns", "_import_rows", "_import_errors"),
    "import_runs": ("_watchable", "_import_runs"),
    "alert_rules": ("GUARANTEED_PER_STATUS", "_api_request_logs", "_alert_rules"),
    "background_jobs": ("background_job",),
    "assembly": ("build", "_background_jobs"),
})
