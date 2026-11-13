"""Saved Data Explorer questions with owner-only mutation and SQL visibility.
See docs/architecture/backend/saved-searches.md."""

from __future__ import annotations

from src.core.facade import lazy

__getattr__, __dir__, __all__ = lazy(__name__, {
    "access": (
        "VIEW_MODES", "ORDERS", "SHARE_PERMISSION", "_make_sole_default", "_visible_statement",
        "_visible", "_owned_visible",
    ),
    "validation": (
        "_resource", "_condition", "_query_text", "_sort", "_order", "_columns", "_page_size",
        "_view_mode", "_SCHEMA", "_validated",
    ),
    "serializers": (
        "KIND", "_member_ids", "_replace_members", "_members", "_apply_favorite", "_serialize",
        "_state",
    ),
    "ownership": ("transfer",),
    "searches": ("list_searches", "get", "create", "update", "remove", "duplicate"),
})
