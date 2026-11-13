"""A role as the API returns it."""

from __future__ import annotations

from typing import Any

from src.core.auth import PERMISSION_LABELS, ROLE_DEFAULTS


def _state(role) -> dict[str, Any]:
    return {
        "name": role.name,
        "description": role.description or "",
        "permissions": sorted(role.permissions or []),
    }


def _serialize(role, holders: int, principal) -> dict[str, Any]:
    permissions = sorted(role.permissions or [])
    default = ROLE_DEFAULTS.get(role.code, {})
    return {
        "id": str(role.id),
        "code": role.code,
        "name": role.name,
        "description": role.description or "",
        "rank": role.rank,
        "color": role.color,
        "is_system": bool(role.is_system),
        "is_default": bool(role.is_default),
        "permissions": permissions,
        "permission_labels": [PERMISSION_LABELS.get(p, p) for p in permissions],
        "user_count": holders,
        # What the seed would have written, so the screen can show that a role
        # has been changed from its shipped defaults — and what from.
        "default_permissions": sorted(default.get("permissions", [])),
        "customised": sorted(default.get("permissions", [])) != permissions,
        #: True for the role the caller themselves holds. The UI marks it,
        #: because editing your own permissions is the edit most likely to be
        #: made by accident.
        "is_yours": role.code == principal.role_code,
    }
