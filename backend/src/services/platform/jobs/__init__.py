"""The background job queue (§23): what ran, what failed, what can be tried again.
See docs/architecture/backend/jobs.md."""

from __future__ import annotations

from src.core.facade import lazy

__getattr__, __dir__, __all__ = lazy(__name__, {
    "policy": (
        "VIEW_PERMISSION", "MANAGE_PERMISSION", "MAX_ALLOWED_ATTEMPTS", "MAX_LOG_LINES", "_fields",
        "DEFAULT_COLUMNS", "_statement", "NOT_OURS_TO_RETRY", "can_retry", "can_cancel",
        "can_allow_attempts", "summarise", "catalogue",
    ),
    "listing_view": ("listing", "entry", "_job", "retry"),
    "controls": ("cancel", "allow_attempts"),
})
