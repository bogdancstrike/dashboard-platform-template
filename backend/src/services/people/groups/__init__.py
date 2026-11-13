"""Groups (§11): sets of people, and the permissions being in one adds.
See docs/architecture/backend/groups.md."""

from __future__ import annotations

from src.core.facade import lazy

__getattr__, __dir__, __all__ = lazy(__name__, {
    "checks": (
        "VIEW_PERMISSION", "MEMBERS_PERMISSION", "GRANTS_PERMISSION", "_NAME", "MAX_MEMBERS",
        "_fields", "DEFAULT_COLUMNS", "_statement", "_slug", "_checked_name", "_checked_kind",
        "_checked_grants", "summarise", "catalogue",
    ),
    "listing_view": ("_member_counts", "listing", "_group", "entry", "create"),
    "changes": ("update", "set_grants"),
    "members": ("set_members", "remove"),
})
