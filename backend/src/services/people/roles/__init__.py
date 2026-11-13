"""Roles and the permission matrix (§13).
See docs/architecture/backend/roles.md."""

from __future__ import annotations

from src.core.facade import lazy

__getattr__, __dir__, __all__ = lazy(__name__, {
    "role_list": (
        "VIEW_PERMISSION", "MANAGE_PERMISSION", "SELF_LOCKOUT_GUARD", "MAX_NAME",
        "MAX_DESCRIPTION", "_CODE", "catalogue", "listing", "update", "_clean_permissions",
    ),
    "role_lifecycle": ("create", "remove"),
    "serializers": ("_state", "_serialize"),
})
