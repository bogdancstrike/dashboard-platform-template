"""Announcements — the platform talking to the people using it (§17, §34).
See docs/architecture/backend/announcements.md."""

from __future__ import annotations

from src.core.facade import lazy

__getattr__, __dir__, __all__ = lazy(__name__, {
    "vocabulary": (
        "MANAGE_PERMISSION", "CATEGORIES", "SEVERITIES", "STATUSES", "CATEGORY_LABELS",
        "_live_clause", "_audience_clause", "_unread_count", "_receipts_for", "_notice",
        "_category", "_one_of",
    ),
    "feed_view": ("feed", "_category_counts"),
    "serializers": ("_state", "_visible_to"),
    "validation": (
        "_row", "_organization", "_window_opens_before_it_closes", "_SCHEMA", "_validated",
        "_status", "_roles", "_moment",
    ),
    "authoring": ("drafts", "_NO_REACH", "_reach_for", "get", "create"),
    "changes": ("update", "remove", "mark"),
})
