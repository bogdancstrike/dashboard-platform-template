"""Record version history with point-in-time restore (§17).
See docs/architecture/backend/versions.md."""

from __future__ import annotations

from src.core.facade import lazy

__getattr__, __dir__, __all__ = lazy(__name__, {
    "subjects": (
        "RESTORE_PERMISSION", "MAX_ROWS", "Subject", "_subject", "_audit_rows", "_touched",
    ),
    "history_view": (
        "build", "_later_fields", "_resolve", "history", "compare", "_number", "_moment",
    ),
    "restoring": ("restore", "_refuse_lost_race"),
})
