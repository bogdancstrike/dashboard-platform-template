"""Who is calling: the `Principal` and the role a token's claims map to."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any
from uuid import UUID

from src.config import Config
from src.core.auth.permissions import ADMIN_AREA_PERMISSION, PERMISSION_LABELS
from src.core.auth.roles import DEFAULT_ROLE_CODE, REALM_ROLE_MAP, ROLE_DEFAULTS
from src.core.errors import ForbiddenError


def role_from_claims(claims: dict[str, Any]) -> str:
    """Highest-ranked platform role among the realm roles on the token.

    Falls back to VIEWER rather than refusing: a realm user with no mapped role
    should see the read-only product, not a 403 wall with no way forward.
    """
    realm_roles = (claims.get("realm_access") or {}).get("roles") or []
    client_roles = (
        (claims.get("resource_access") or {}).get(Config.KEYCLOAK_AUDIENCE) or {}
    ).get("roles") or []
    codes = {
        REALM_ROLE_MAP[str(name).lower()]
        for name in list(realm_roles) + list(client_roles)
        if str(name).lower() in REALM_ROLE_MAP
    }
    if not codes:
        return DEFAULT_ROLE_CODE
    return max(codes, key=lambda code: ROLE_DEFAULTS.get(code, {}).get("rank", 0))


@dataclass(slots=True)
class Principal:
    """Who is asking, and what they may do. Built once per request."""

    user_id: UUID
    subject: str
    email: str
    username: str
    full_name: str
    role_code: str
    permissions: frozenset[str]
    realm_roles: tuple[str, ...] = field(default_factory=tuple)
    organization_id: UUID | None = None
    department_id: UUID | None = None
    session_id: str = ""
    impersonator_id: UUID | None = None
    impersonator_label: str = ""
    groups: tuple[str, ...] = field(default_factory=tuple)

    def can(self, *permissions: str) -> bool:
        """True when the principal holds *every* named permission."""
        return all(p in self.permissions for p in permissions)

    def can_any(self, *permissions: str) -> bool:
        return any(p in self.permissions for p in permissions)

    def require(self, *permissions: str) -> None:
        missing = [p for p in permissions if p not in self.permissions]
        if missing:
            raise ForbiddenError(
                "You do not have permission to perform this action.",
                details={
                    "missing": missing,
                    "missing_labels": [PERMISSION_LABELS.get(m, m) for m in missing],
                    "role": self.role_code,
                },
            )

    @property
    def is_admin(self) -> bool:
        return ADMIN_AREA_PERMISSION in self.permissions

    @property
    def is_impersonating(self) -> bool:
        return self.impersonator_id is not None

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": str(self.user_id),
            "subject": self.subject,
            "email": self.email,
            "username": self.username,
            "full_name": self.full_name,
            "role": self.role_code,
            "realm_roles": list(self.realm_roles),
            "permissions": sorted(self.permissions),
            "is_admin": self.is_admin,
            "organization_id": str(self.organization_id) if self.organization_id else None,
            "department_id": str(self.department_id) if self.department_id else None,
            "groups": list(self.groups),
            "impersonating": self.is_impersonating,
            "impersonator_id": str(self.impersonator_id) if self.impersonator_id else None,
            "impersonator_label": self.impersonator_label,
        }
