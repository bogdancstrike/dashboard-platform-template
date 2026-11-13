"""Bookmarks and recents — one store for "what have I starred" (§38, §39).
See docs/architecture/backend/favorites.md."""

from __future__ import annotations

from src.core.facade import lazy

__getattr__, __dir__, __all__ = lazy(__name__, {
    "favorite_state": (
        "MAX_FAVORITES", "MAX_RECENTS", "_EXTRA_TYPES", "bookmarkable", "is_favorite_of",
        "favorite_ids", "set_favorite", "_refuse_if_full", "_next_position",
    ),
    "favorites_page": ("_serialise", "listing", "add", "remove", "arrange"),
    "recent_items": ("recents", "visit", "_trim_recents", "clear_recents"),
})
