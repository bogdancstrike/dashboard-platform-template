"""The platform's own request log, written to the table `/admin/logs` reads.
See docs/architecture/backend/logsink.md."""

from __future__ import annotations

from src.core.facade import lazy

__getattr__, __dir__, __all__ = lazy(__name__, {
    "hooks": (
        "_PREFIX", "IGNORED_PREFIXES", "SLOW_MILLISECONDS", "level_for", "install", "_describe",
        "_trace_id",
    ),
    "writing": ("record", "_now", "sweep"),
})
