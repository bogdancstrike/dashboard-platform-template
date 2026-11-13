"""The local user a token maps to: sync, permissions, impersonation."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from src.config import Config
from src.core.auth.principal import Principal, role_from_claims
from src.core.auth.roles import DEFAULT_ROLE_CODE, ROLE_DEFAULTS
from src.core.auth.sessions import SESSION_TOUCH_SECONDS, touch_session
from src.core.errors import ForbiddenError


def principal_from_claims(claims: dict[str, Any]) -> Principal:
    from src.core.db import session_scope

    subject = str(claims.get("sub") or "")
    email = str(claims.get("email") or f"{claims.get('preferred_username', subject)}@example.local")
    username = str(claims.get("preferred_username") or email.split("@")[0])
    full_name = str(claims.get("name") or username.replace(".", " ").title())
    role_code = role_from_claims(claims)
    realm_roles = tuple((claims.get("realm_access") or {}).get("roles") or [])

    with session_scope() as session:
        user = sync_user(
            session,
            subject=subject,
            email=email,
            username=username,
            full_name=full_name,
            role_code=role_code,
        )
        permissions = permissions_for(session, user, role_code)
        # Refused here, before a single permission is consulted: a signed-out
        # session must not be able to *read* either. See `touch_session`.
        touch_session(session, user, claims)
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


def sync_user(session, *, subject: str, email: str, username: str, full_name: str, role_code: str):
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

    # At most once a minute, like the session's `last_seen_at`. Writing it on
    # every request made each authenticated call an UPDATE of the caller's
    # own `users` row; under load every request of one person queued on that
    # row's lock, and the 1000-user load test stalled behind it
    # (docs/testing/performance.md).
    moment = now()
    if user.last_login_at is None or (moment - user.last_login_at).total_seconds() > SESSION_TOUCH_SECONDS:
        user.last_login_at = moment
    return user


def permissions_for(session, user, role_code: str) -> set[str]:
    """Permissions come from the *database*, not the token, so a change made on
    the roles screen applies on the caller's very next request."""
    from sqlalchemy import select

    from src.models.identity import Role

    # The user's own role is already loaded (`sync_user` selects it in); a
    # second query is only needed when the token names a different role.
    role = user.role if user.role is not None and user.role.code == role_code else None
    if role is None:
        role = session.scalars(select(Role).where(Role.code == role_code)).first()
    permissions = set(role.permissions or []) if role else set()
    if not permissions:
        # The roles table has not been seeded yet (fresh database, first call).
        permissions = set(ROLE_DEFAULTS.get(role_code, {}).get("permissions", []))
    for group in user.groups:
        permissions.update(group.permissions or [])
    return permissions


def impersonate(admin: Principal, target: str) -> Principal:
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
            permissions=frozenset(permissions_for(session, user, role_code)),
            organization_id=user.organization_id,
            department_id=user.department_id,
            session_id=admin.session_id,
            impersonator_id=admin.user_id,
            impersonator_label=admin.full_name,
            groups=tuple(group.name for group in user.groups),
        )
