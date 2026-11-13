"""The timeline: tasks as bars in time, with the dependencies between them (§18).
See docs/architecture/backend/timeline.md."""

from __future__ import annotations

from src.core.facade import lazy

__getattr__, __dir__, __all__ = lazy(__name__, {
    "spans": ("MAX_BARS", "GROUPINGS", "CLOSED", "as_day", "at_midnight", "span_of", "violates"),
    "paths": ("_name", "_person", "_link", "critical_path", "_topological"),
    "unlinking": ("link", "unlink"),
    "scheduling": ("_task", "schedule", "_violation", "_shift_downstream", "_reaches"),
    "reading": ("timeline", "_many"),
})
