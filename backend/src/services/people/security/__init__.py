"""The reader's own security page (§41): sessions, sign-ins, and what to worry about.
See docs/architecture/backend/security.md."""

from __future__ import annotations

from src.core.facade import lazy

__getattr__, __dir__, __all__ = lazy(__name__, {
    "sessions_view": (
        "HISTORY_DAYS", "FAILURES_WORTH_SAYING", "_mine", "expired", "state", "_session",
        "sessions", "revoke", "revoke_others", "_own_session",
    ),
    "history_view": ("trust", "_history_fields", "history"),
    "alerts": ("events", "_event", "resolve"),
    "overview_page": ("overview",),
})
