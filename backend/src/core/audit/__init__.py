"""The audit trail (§21) and the activity feed (§35), written from one place.
See docs/architecture/backend/audit.md."""

from __future__ import annotations

from src.core.facade import lazy

__getattr__, __dir__, __all__ = lazy(__name__, {
    "redaction": (
        "ACTIONS", "RESULTS", "_REDACTED", "MASK", "is_secret", "redact", "jsonable", "diff",
    ),
    "recording": ("record", "_activity_kind", "_summarise"),
})
