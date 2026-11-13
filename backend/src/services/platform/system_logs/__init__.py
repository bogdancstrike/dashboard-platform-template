"""The system log viewer (§22): what the platform has been doing, and why.
See docs/architecture/backend/logs.md."""

from __future__ import annotations

from src.core.facade import lazy

__getattr__, __dir__, __all__ = lazy(__name__, {
    "log_filters": (
        "PERMISSION", "MAX_RELATED", "MAX_TAIL", "_fields", "DEFAULT_COLUMNS", "_statement",
        "_at_least", "_apply_severity", "summarise", "catalogue", "_retention",
    ),
    "log_reads": ("listing", "tail", "entry", "_related", "prune"),
})
