"""The notification centre (§17), and the fan-out behind the live feed.
See docs/architecture/backend/notifications.md."""

from __future__ import annotations

from src.core.facade import lazy

__getattr__, __dir__, __all__ = lazy(__name__, {
    "counting": (
        "CATEGORIES", "SEVERITIES", "badges", "serialize", "_base_query", "counts", "_clauses",
        "_group_key",
    ),
    "listing_view": ("listing", "_grouped", "mark_read", "mark_unread"),
    "delivery": ("mark_all_read", "delete", "publish"),
})
