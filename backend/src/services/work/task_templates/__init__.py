"""Templates, recurring tasks, and the scheduler that makes the next one (§18, §23).
See docs/architecture/backend/task-templates.md."""

from __future__ import annotations

from src.core.facade import lazy

__getattr__, __dir__, __all__ = lazy(__name__, {
    "template_store": (
        "FREQUENCIES", "UNITS", "WEEKDAY_NAMES", "MAX_CATCH_UP", "JOBS", "_template", "_checklist",
        "serialize_template", "templates", "_apply_fields", "create_template", "update_template",
        "_audit_template",
    ),
    "template_use": ("remove_template", "template", "use_template", "_label", "save_as_template"),
    "recurrence_rules": (
        "next_after", "describe_rule", "recurrence", "set_recurrence", "clear_recurrence",
    ),
    "occurrences": ("occurrence", "run_recurrences"),
    "scheduler": ("ensure_jobs", "run_scheduler", "run_now", "catch_up"),
})
