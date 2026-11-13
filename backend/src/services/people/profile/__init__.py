"""A person's own page, and a colleague's (§40, §41).
See docs/architecture/backend/profile.md."""

from __future__ import annotations

from src.core.facade import lazy

__getattr__, __dir__, __all__ = lazy(__name__, {
    "work_stats": ("THROUGHPUT_WEEKS", "_analytics", "_stats", "_throughput"),
    "activity_trail": (
        "HEATMAP_DAYS", "TOUCH_LIMIT", "RECENT_ACTIVITY", "_heatmap", "_touches", "_recent",
    ),
    "person_page": ("profile", "_person", "_team", "_named"),
})
