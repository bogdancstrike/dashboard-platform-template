"""Authentication against Keycloak, the permission catalogue, and the guards.

Keycloak owns identity; the platform owns authorization *detail*. That split is
deliberate:

* **Keycloak** proves who the caller is and which realm role they hold. The
  access token is verified against the realm's JWKS on every request.
* **The platform** turns that role into a permission set, from the editable
  `roles` table. Which means the roles-and-permissions admin screen (§13) is a
  real screen that changes real behaviour, without an admin having to leave the
  application to edit an identity provider.

Code always asks "may this principal export records?", never "is this an
admin?" — the second question has to be re-answered in twenty places the day a
new role appears.

Realm role → platform role code is a straight uppercase mapping
(`administrator` → `ADMINISTRATOR`); when a token carries several, the
highest-ranked one wins.
"""

from __future__ import annotations

import functools
import hashlib
import json
import threading
import time
from dataclasses import dataclass, field
from typing import Any
from uuid import UUID

import requests
from flask import g, request
from jose import jwt
from jose.exceptions import JWTError

from src.config import Config
from src.core.errors import ForbiddenError, UnauthorizedError

# ── The permission catalogue (§13) ───────────────────────────────────────
# Grouped by the area of the product they gate. The admin UI renders the
# permission matrix straight off this structure, so a permission that exists in
# code cannot be missing from the screen that grants it.

PERMISSION_GROUPS: dict[str, list[tuple[str, str]]] = {
    "Records": [
        ("records.view", "View records"),
        ("records.create", "Create records"),
        ("records.update", "Update records"),
        ("records.delete", "Delete records"),
        ("records.export", "Export records"),
        ("records.import", "Import records"),
        ("records.bulk", "Run bulk operations"),
    ],
    "Administration": [
        ("admin.access", "Open the administration area"),
        ("users.view", "View users"),
        ("users.manage", "Manage users"),
        ("users.impersonate", "Impersonate users"),
        ("roles.manage", "Manage roles and permissions"),
        ("orgs.manage", "Manage organizations"),
        ("settings.manage", "Manage system settings"),
        ("flags.manage", "Manage feature flags"),
        ("integrations.manage", "Manage integrations"),
        ("api.manage", "Manage API credentials"),
    ],
    "Operations": [
        ("jobs.view", "View background jobs"),
        ("jobs.manage", "Retry and cancel jobs"),
        ("logs.view", "View system logs"),
        ("audit.view", "View audit logs"),
        ("health.view", "View system health"),
    ],
    "Workspace": [
        ("tasks.view", "View tasks"),
        ("tasks.manage", "Assign and edit tasks"),
        ("mail.access", "Use the mailbox"),
        ("files.view", "View files"),
        ("files.manage", "Upload and organise files"),
        ("calendar.view", "View the calendar"),
        ("calendar.manage", "Create and edit events"),
        ("reports.view", "View reports"),
        ("reports.manage", "Build and save reports"),
        ("dashboards.manage", "Customise dashboards"),
        ("searches.share", "Share saved searches and views"),
    ],
}

ALL_PERMISSIONS: tuple[str, ...] = tuple(
    code for group in PERMISSION_GROUPS.values() for code, _ in group
)
PERMISSION_LABELS: dict[str, str] = {
    code: label for group in PERMISSION_GROUPS.values() for code, label in group
}

#: `admin.access` is the single gate the frontend reads to decide whether the
#: administration section exists at all. Only ADMINISTRATOR holds it, which is
#: what makes `user` unable to see the admin panels that `admin` can.
ADMIN_AREA_PERMISSION = "admin.access"

#: The five demo personas of §58, seeded into the `roles` table. Keycloak
#: carries the *membership*; these carry the meaning.
ROLE_DEFAULTS: dict[str, dict[str, Any]] = {
    "ADMINISTRATOR": {
        "name": "Administrator",
        "description": "Unrestricted access to every module and setting.",
        "rank": 100,
        "color": "#dc2626",
        "permissions": list(ALL_PERMISSIONS),
    },
    "MANAGER": {
        "name": "Manager",
        "description": "Manages teams, operational data and reporting.",
        "rank": 80,
        "color": "#7c3aed",
        "permissions": [
            "records.view", "records.create", "records.update", "records.export",
            "records.import", "records.bulk",
            "users.view", "users.manage",
            "jobs.view", "jobs.manage", "audit.view", "health.view", "logs.view",
            "tasks.view", "tasks.manage", "mail.access",
            "files.view", "files.manage", "calendar.view", "calendar.manage",
            "reports.view", "reports.manage", "dashboards.manage", "searches.share",
        ],
    },
    "OPERATOR": {
        "name": "Operator",
        "description": "Works the operational record and task queues.",
        "rank": 60,
        "color": "#0891b2",
        "permissions": [
            "records.view", "records.create", "records.update", "records.export",
            "users.view", "jobs.view", "health.view",
            "tasks.view", "tasks.manage", "mail.access",
            "files.view", "files.manage", "calendar.view", "calendar.manage",
            "reports.view", "dashboards.manage",
        ],
    },
    "ANALYST": {
        "name": "Analyst",
        "description": "Dashboards, reports, search and export. Reads, never writes.",
        "rank": 50,
        "color": "#16a34a",
        "permissions": [
            "records.view", "records.export",
            "users.view", "audit.view", "health.view", "jobs.view",
            "tasks.view", "files.view", "calendar.view",
            "reports.view", "reports.manage", "dashboards.manage", "searches.share",
        ],
    },
    "VIEWER": {
        "name": "Viewer",
        "description": "Read-only access to records, tasks and dashboards.",
        "rank": 20,
        "color": "#64748b",
        "permissions": [
            "records.view", "users.view", "tasks.view", "files.view",
            "calendar.view", "reports.view", "health.view", "mail.access",
        ],
    },
}

#: Realm role name (lowercase, as Keycloak spells it) → platform role code.
REALM_ROLE_MAP: dict[str, str] = {
    "administrator": "ADMINISTRATOR",
    "admin": "ADMINISTRATOR",
    "manager": "MANAGER",
    "operator": "OPERATOR",
    "analyst": "ANALYST",
    "viewer": "VIEWER",
    "user": "VIEWER",
}

DEFAULT_ROLE_CODE = "VIEWER"


# ── Token verification ───────────────────────────────────────────────────


class _JwksCache:
    """Realm signing keys, refreshed on a miss or when stale.

    A cache miss on an unknown `kid` triggers exactly one refresh — that is
    what makes a Keycloak key rotation self-healing instead of a restart.
    """

    def __init__(self) -> None:
        self._keys: dict[str, dict] = {}
        self._fetched_at = 0.0
        self._lock = threading.Lock()

    def _stale(self) -> bool:
        return (time.time() - self._fetched_at) > Config.JWKS_CACHE_TTL

    def get(self, kid: str) -> dict | None:
        if kid in self._keys and not self._stale():
            return self._keys[kid]
        self.refresh()
        return self._keys.get(kid)

    def refresh(self) -> None:
        from framework.commons.logger import logger as log

        url = Config.keycloak_jwks_url()
        with self._lock:
            try:
                response = requests.get(url, timeout=5)
                response.raise_for_status()
                self._keys = {k["kid"]: k for k in response.json().get("keys", [])}
                self._fetched_at = time.time()
            except Exception as exc:
                log.warning(f"jwks fetch failed from {url}: {exc}")

    def ready(self) -> bool:
        if not self._keys or self._stale():
            self.refresh()
        return bool(self._keys)


_jwks = _JwksCache()


def verify_token(token: str) -> dict[str, Any]:
    """Verify signature, issuer, audience and expiry. Raises Unauthorized.

    Successful claims are cached in Redis until the JWT itself expires. The
    cache key is a SHA-256 digest, never the bearer token, so neither Redis keys
    nor values expose a reusable credential. Cache failure is only a miss.
    """
    if not token:
        raise UnauthorizedError("Authentication required.")

    from src.core import cache

    cache_key = _token_cache_key(token)
    cached = cache.get_json(cache_key)
    current_time = time.time()
    if isinstance(cached, dict) and _expiry(cached) > current_time:
        return cached

    try:
        header = jwt.get_unverified_header(token)
    except JWTError as exc:
        raise UnauthorizedError("Malformed authentication token.") from exc

    kid = header.get("kid")
    if not kid:
        raise UnauthorizedError("Token is missing a key id.")
    key = _jwks.get(kid)
    if key is None:
        raise UnauthorizedError("Token was signed by an unknown key.")

    try:
        claims = jwt.decode(
            token,
            key,
            algorithms=[key.get("alg", "RS256")],
            audience=Config.KEYCLOAK_AUDIENCE,
            issuer=Config.keycloak_issuer(),
            options={
                "verify_at_hash": False,
                # Keycloak puts the SPA client in `azp`, not `aud`; the audience
                # mapper supplies `aud`. Both are checked above.
                "leeway": Config.JWT_LEEWAY_SECONDS,
            },
        )
        seconds_left = int(_expiry(claims) - current_time)
        if seconds_left > 0:
            cache.set_json(cache_key, claims, ttl=seconds_left)
        return claims
    except JWTError as exc:
        message = str(exc)
        if "expired" in message.lower():
            raise UnauthorizedError("Your session has expired. Sign in again.") from exc
        raise UnauthorizedError(f"Token verification failed: {message}") from exc


def _token_cache_key(token: str) -> str:
    digest = hashlib.sha256(token.encode("utf-8")).hexdigest()
    return f"{Config.SERVICE_NAME}:auth:token:{digest}"


def _expiry(claims: dict[str, Any]) -> float:
    try:
        return float(claims.get("exp") or 0)
    except (TypeError, ValueError):
        return 0.0


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


# ── Request → Principal ──────────────────────────────────────────────────


def _bearer() -> str | None:
    header = request.headers.get("Authorization") or ""
    if header.lower().startswith("bearer "):
        return header[7:].strip() or None
    return None


def principal_from_request(*, required: bool = True) -> Principal | None:
    """Resolve the caller. Cached on `g` — several guards may run per request."""
    cached = getattr(g, "principal", None)
    if cached is not None:
        return cached

    token = _bearer()
    if not token:
        if required:
            raise UnauthorizedError("Authentication required.")
        return None

    claims = verify_token(token)
    principal = _principal_from_claims(claims)

    # Impersonation (§12) rides in a header rather than a second token: the
    # admin's own identity stays the one Keycloak proved, and every audit row
    # records both sides. Only an admin may set it.
    target = request.headers.get("X-Impersonate-User")
    if target and principal.can("users.impersonate"):
        principal = _impersonate(principal, target)

    g.principal = principal
    return principal


def _principal_from_claims(claims: dict[str, Any]) -> Principal:
    from src.core.db import session_scope

    subject = str(claims.get("sub") or "")
    email = str(claims.get("email") or f"{claims.get('preferred_username', subject)}@example.local")
    username = str(claims.get("preferred_username") or email.split("@")[0])
    full_name = str(claims.get("name") or username.replace(".", " ").title())
    role_code = role_from_claims(claims)
    realm_roles = tuple((claims.get("realm_access") or {}).get("roles") or [])

    with session_scope() as session:
        user = _sync_user(
            session,
            subject=subject,
            email=email,
            username=username,
            full_name=full_name,
            role_code=role_code,
        )
        permissions = _permissions_for(session, user, role_code)
        return Principal(
            user_id=user.id,
            subject=subject,
            email=user.email,
            username=user.username,
            full_name=user.full_name,
            role_code=role_code,
            permissions=frozenset(permissions),
            realm_roles=realm_roles,
            organization_id=user.organization_id,
            department_id=user.department_id,
            session_id=str(claims.get("sid") or ""),
            groups=tuple(group.name for group in user.groups),
        )


def _sync_user(session, *, subject: str, email: str, username: str, full_name: str, role_code: str):
    """Find (or create) the local profile behind a realm identity.

    Matching is by external subject first, then by email — which is what lets
    the seeded demo users (`admin@…`, `user@…`) adopt their Keycloak identity
    on first sign-in instead of spawning a duplicate profile beside them.
    """
    from sqlalchemy import select
    from sqlalchemy.orm import selectinload

    from src.core.clock import now
    from src.models.identity import Role, User

    def _load(clause):
        return session.scalars(
            select(User).options(selectinload(User.groups), selectinload(User.role)).where(clause)
        ).first()

    user = _load(User.external_id == subject) if subject else None
    if user is None:
        user = _load(User.email == email.lower())
    if user is None:
        user = _load(User.username == username)

    if user is None:
        if not Config.AUTO_PROVISION_USERS:
            raise ForbiddenError("No platform profile exists for this account.")
        role = session.scalars(select(Role).where(Role.code == role_code)).first()
        user = User(
            external_id=subject,
            email=email.lower(),
            username=username,
            full_name=full_name,
            first_name=full_name.split(" ")[0],
            last_name=" ".join(full_name.split(" ")[1:]) or None,
            status="ACTIVE",
            role_id=role.id if role else None,
            profile_completeness=60,
        )
        session.add(user)
        session.flush()
    else:
        if subject and user.external_id != subject:
            user.external_id = subject
        if user.status != "ACTIVE":
            raise ForbiddenError(
                f"This account is {user.status.lower()}.", details={"status": user.status}
            )
        # Keep the local row aligned with the realm on every sign-in; the realm
        # is the authority for name and email.
        user.full_name = full_name or user.full_name
        user.email = email.lower() or user.email

    user.last_login_at = now()
    return user


def _permissions_for(session, user, role_code: str) -> set[str]:
    """Permissions come from the *database*, not the token, so a change made on
    the roles screen applies on the caller's very next request."""
    from sqlalchemy import select

    from src.models.identity import Role

    role = session.scalars(select(Role).where(Role.code == role_code)).first()
    permissions = set(role.permissions or []) if role else set()
    if not permissions:
        # The roles table has not been seeded yet (fresh database, first call).
        permissions = set(ROLE_DEFAULTS.get(role_code, {}).get("permissions", []))
    for group in user.groups:
        permissions.update(group.permissions or [])
    return permissions


def _impersonate(admin: Principal, target: str) -> Principal:
    from sqlalchemy import select
    from sqlalchemy.orm import selectinload

    from src.core.db import session_scope
    from src.core.errors import NotFoundError
    from src.models.identity import User

    with session_scope() as session:
        try:
            clause = User.id == UUID(target)
        except (TypeError, ValueError):
            clause = User.email == str(target).lower()
        user = session.scalars(
            select(User).options(selectinload(User.groups), selectinload(User.role)).where(clause)
        ).first()
        if user is None:
            raise NotFoundError("The user to impersonate does not exist.")
        role_code = user.role.code if user.role else DEFAULT_ROLE_CODE
        return Principal(
            user_id=user.id,
            subject=user.external_id or "",
            email=user.email,
            username=user.username,
            full_name=user.full_name,
            role_code=role_code,
            permissions=frozenset(_permissions_for(session, user, role_code)),
            organization_id=user.organization_id,
            department_id=user.department_id,
            session_id=admin.session_id,
            impersonator_id=admin.user_id,
            impersonator_label=admin.full_name,
            groups=tuple(group.name for group in user.groups),
        )


# ── Endpoint guards ──────────────────────────────────────────────────────
# QF's dynamic router calls handlers as `fn(app=..., operation=..., request=...,
# **path_params)`, so these decorators keep that signature intact.


def authenticated(fn):
    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        principal_from_request(required=True)
        return fn(*args, **kwargs)

    return wrapper


def requires(*permissions: str):
    """Guard an endpoint with one or more permissions (all must be held)."""

    def decorator(fn):
        @functools.wraps(fn)
        def wrapper(*args, **kwargs):
            principal = principal_from_request(required=True)
            principal.require(*permissions)
            return fn(*args, **kwargs)

        wrapper.__platform_permissions__ = permissions
        return wrapper

    return decorator


def optional(fn):
    """Public endpoint that still wants to know the caller when there is one."""

    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        try:
            principal_from_request(required=False)
        except (UnauthorizedError, ForbiddenError):
            g.principal = None
        return fn(*args, **kwargs)

    return wrapper


def me() -> Principal:
    """The current principal inside an already-guarded handler."""
    principal = getattr(g, "principal", None)
    if principal is None:
        principal = principal_from_request(required=True)
    return principal


def maybe_me() -> Principal | None:
    return getattr(g, "principal", None)


# ── Request helpers ──────────────────────────────────────────────────────


def session_fingerprint() -> dict[str, str]:
    """What gets recorded on a session/audit row about *how* a call arrived."""
    agent = request.headers.get("User-Agent", "")
    forwarded = request.headers.get("X-Forwarded-For", "")
    ip = (forwarded.split(",")[0].strip() if forwarded else request.remote_addr) or "0.0.0.0"
    return {"ip_address": ip, "user_agent": agent[:400], "device": _device_of(agent)}


def _device_of(agent: str) -> str:
    lowered = agent.lower()
    if "iphone" in lowered or "android" in lowered:
        return "Mobile"
    if "ipad" in lowered or "tablet" in lowered:
        return "Tablet"
    if "curl" in lowered or "python" in lowered or "postman" in lowered:
        return "API client"
    for name, label in (
        ("edg", "Edge"), ("chrome", "Chrome"), ("firefox", "Firefox"), ("safari", "Safari")
    ):
        if name in lowered:
            return label
    return "Unknown"


def mask_secret(value: str, *, keep: int = 4) -> str:
    """Never show a full credential after creation (§76)."""
    if not value:
        return ""
    if len(value) <= keep:
        return "•" * len(value)
    return f"{value[:keep]}{'•' * 8}{value[-keep:]}"


def json_body() -> dict[str, Any]:
    """Parsed request body, tolerant of an empty one."""
    from src.core.errors import ValidationError

    if not request.data:
        return {}
    try:
        body = request.get_json(force=True, silent=False)
    except Exception as exc:
        raise ValidationError("Request body must be valid JSON.") from exc
    if body is None:
        return {}
    if not isinstance(body, dict):
        raise ValidationError("Request body must be a JSON object.")
    return body


def dump(value: Any) -> str:
    return json.dumps(value, default=str, sort_keys=True)


def auth_health() -> dict[str, Any]:
    """Whether the realm's keys are reachable — surfaced on §24."""
    started = time.perf_counter()
    ok = _jwks.ready()
    return {
        "status": "healthy" if ok else "unavailable",
        "latency_ms": round((time.perf_counter() - started) * 1000, 2),
        "issuer": Config.keycloak_issuer(),
        "realm": Config.KEYCLOAK_REALM,
    }
