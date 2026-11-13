"""Time tracking (§50): a timer, entries, the week grid, timesheets for approval, reports and export.
See docs/architecture/backend/timekeeping.md."""

from __future__ import annotations

from src.core.facade import lazy

__getattr__, __dir__, __all__ = lazy(__name__, {
    "common": (
        "TRACK", "APPROVE", "SUBJECT_TYPES", "LOCKED", "MAX_ENTRY_MINUTES", "week_start", "_day",
        "_moment", "_minutes", "_person_for", "subject_info", "_link", "_sheet",
        "_refuse_if_locked", "serialize",
    ),
    "timer": ("_running", "current", "_close", "start", "stop"),
    "entries": ("_load", "_owned", "listing", "_apply_times", "create", "update", "delete"),
    "weekly": ("_sheet_body", "week", "set_cell"),
    "timesheets": (
        "submit_week", "_apply_timesheet", "_withdraw_timesheet", "_describe_timesheet", "team",
    ),
    "reports": (
        "GROUPS", "_report_clauses", "report", "EXPORT_COLUMNS", "export", "subjects",
        "on_subject",
    ),
})
