"""Exports (§29): a queued job per request, produced off the request, downloaded, then let go.
See docs/architecture/backend/exports.md."""

from __future__ import annotations

from src.core.facade import lazy

__getattr__, __dir__, __all__ = lazy(__name__, {
    "policy": (
        "PERMISSION", "KIND", "QUEUE", "DEFAULT_MAX_ROWS", "DEFAULT_RETENTION_DAYS",
        "MAX_PENDING_PER_PERSON", "_PENDING", "STALL_AFTER_SECONDS", "_setting", "max_rows",
        "retention_days", "expires_at", "_expired", "stalled", "REFERENCE_PREFIX", "_reference",
        "_line",
    ),
    "reading": ("_fields", "_mine", "_serialise", "_describe", "listing", "_row_for", "entry"),
    "offering": ("catalogue", "estimate"),
    "queueing": ("queue", "again"),
    "producing": ("produce", "run"),
    "delivery": ("download", "forget", "_drop"),
})
