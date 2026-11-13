"""SLA policies: which tickets, what targets, counted in whose hours.
See docs/architecture/backend/sla.md."""

from __future__ import annotations

from src.core.facade import lazy

__getattr__, __dir__, __all__ = lazy(__name__, {
    "business_hours": (
        "MANAGE", "DAYS", "ACTIONS", "NOTIFY_TARGETS", "CONDITION_KEYS", "CLOSED", "MAX_DAYS",
        "_zone", "_parse_hm", "_spans", "add_business_minutes", "business_minutes_between",
        "is_open_now",
    ),
    "clocks": (
        "_policies", "matches", "policy_for", "_target", "_state", "compute", "clock_start",
        "_percent", "_escalate",
    ),
    "escalation": ("sweep",),
    "ticket_view": ("_clock", "for_ticket"),
    "policy_reads": (
        "_calendar_body", "_policy_body", "catalogue", "policies", "policy", "_policy_row",
        "_calendar_row",
    ),
    "policy_checks": (
        "_minutes", "_checked_policy", "_CONDITION_VALUES", "_conditions", "_targets",
        "_calendar_choice", "_pauses", "_step", "_checked_calendar",
    ),
    "policy_writes": (
        "save_policy", "delete_policy", "reorder", "save_calendar", "delete_calendar", "apply_now",
    ),
    "ticket_hooks": ("CLOCK_FIELDS", "_on_record_write", "on_ticket_write", "recompute_all"),
})
