"""The seed runner: schema, writing, verification and the idempotent repairs.
See docs/architecture/backend/modules/seed-runner.md."""

from __future__ import annotations

from src.core.facade import lazy

__getattr__, __dir__, __all__ = lazy(__name__, {
    "schema": (
        "INSERT_ORDER", "DEFERRED_LINKS", "bootstrap_schema", "stamp_head", "schema_drift",
        "sync_schema", "drop_schema", "is_seeded",
    ),
    "drift": ("_headcount_drift", "_tags_out_of_step"),
    "writing": ("generate", "write", "run"),
    "verification": ("verify",),
    "storage_sync": ("sync_files", "sync_exports", "sync_imports"),
    "automation_sync": ("sync_automations", "_derived_condition", "_repaired_action"),
    "activity_sync": ("sync_activity", "sync_health", "HEALTH_STALE_AFTER", "_history_is_stale"),
    "mail_sync": ("sync_mailboxes",),
    "jobs_sync": ("sync_jobs",),
    "settings_sync": ("sync_settings", "_fits"),
    "compile_drift": ("_unrunnable_reports", "_unrunnable_automations"),
    "searches_sync": ("sync_searches",),
    "tags_sync": ("sync_tags", "sync_favorites"),
    "reports_sync": ("sync_reports",),
    "sessions_sync": ("sync_sessions",),
    "org_sync": ("sync_org", "sync_roles"),
    "flags_sync": ("sync_flags", "sync_preferences"),
})
