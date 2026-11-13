"""Authentication against Keycloak, the permission catalogue, and the guards.

Keycloak proves who the caller is; the platform turns the realm role into a
permission set from the editable `roles` table. Code asks "may this principal
export records?", never "is this an admin?". See docs/architecture/backend/auth.md.
"""

from __future__ import annotations

from src.core.auth.caller import json_body, maybe_me, me, principal_from_request
from src.core.auth.guards import authenticated, optional, requires
from src.core.auth.permissions import (
    ADMIN_AREA_PERMISSION,
    ALL_PERMISSIONS,
    PERMISSION_GROUPS,
    PERMISSION_LABELS,
)
from src.core.auth.principal import Principal, role_from_claims
from src.core.auth.roles import DEFAULT_ROLE_CODE, REALM_ROLE_MAP, ROLE_DEFAULTS
from src.core.auth.sessions import SESSION_TOUCH_SECONDS, device_of, session_fingerprint
from src.core.auth.tokens import auth_health, verify_token

__all__ = [
    "ADMIN_AREA_PERMISSION",
    "ALL_PERMISSIONS",
    "DEFAULT_ROLE_CODE",
    "PERMISSION_GROUPS",
    "PERMISSION_LABELS",
    "Principal",
    "REALM_ROLE_MAP",
    "ROLE_DEFAULTS",
    "SESSION_TOUCH_SECONDS",
    "annotations",
    "auth_health",
    "authenticated",
    "device_of",
    "json_body",
    "maybe_me",
    "me",
    "optional",
    "principal_from_request",
    "requires",
    "role_from_claims",
    "session_fingerprint",
    "verify_token",
]
