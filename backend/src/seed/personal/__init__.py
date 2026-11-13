"""Saved searches, views, favorites, recents, dashboards, reports, preferences."""

from __future__ import annotations

from src.core.facade import lazy

__getattr__, __dir__, __all__ = lazy(__name__, {
    "saved_searches": (
        "SEARCH_SCOPES", "SCOPES", "_SPEC", "COLUMN_SETS", "_audience", "_condition_tree",
        "_saved_searches",
    ),
    "dashboards": ("_dashboards", "_analysable"),
    "reports": ("_notification_preferences", "_reports", "_favorites", "_bookmarkable"),
    "shares": ("_shares",),
    "kanban": ("_kanban",),
    "assembly": ("build", "_list_views", "_recent_items"),
})
