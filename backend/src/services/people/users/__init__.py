"""User administration (§12).
See docs/architecture/backend/users.md."""

from __future__ import annotations

from src.core.facade import lazy

__getattr__, __dir__, __all__ = lazy(__name__, {
    "serializers": (
        "RECENT", "summarise", "load_person", "_load", "_sessions", "_sign_ins", "_named",
        "_state",
    ),
    "impersonation": ("IMPERSONATE_PERMISSION", "_may_impersonate", "_role_rank"),
    "directory_view": (
        "VIEW_PERMISSION", "MANAGE_PERMISSION", "STATUSES", "_fields", "DEFAULT_COLUMNS",
        "_statement", "listing", "access_of", "groups_of", "detail",
    ),
    "changes": ("update", "impersonation_target"),
})
