"""The calendar (§21): events and recurring series, expanded into a window.
See docs/architecture/backend/calendar.md."""

from __future__ import annotations

from src.core.facade import lazy

__getattr__, __dir__, __all__ = lazy(__name__, {
    "recurrence": (
        "VIEW", "MANAGE", "MAX_WINDOW_DAYS", "MAX_OCCURRENCES", "WEEKDAYS", "_WEEKDAY_INDEX",
        "Occurrence", "_moment", "_involves", "_expand", "_expand_single", "_weekdays", "_series",
        "_response_of",
    ),
    "window_view": ("window", "_window_bounds", "_clashes", "_counts"),
    "events": (
        "get", "create", "update", "remove", "respond", "_event", "_require_organiser",
        "_with_organiser",
    ),
    "validation": (
        "_times", "_recurrence", "_reminder", "_SCHEMA", "_validated", "_validated_participants",
        "_validated_recurrence", "_optional_moment", "_whole",
    ),
    "serializers": (
        "_occurrence", "_serialize", "_can_edit", "_audit_state", "describe", "_ordinal", "_list",
    ),
})
