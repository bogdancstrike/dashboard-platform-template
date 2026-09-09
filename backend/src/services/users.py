"""User administration (§12).

Three things an administrator needs of a person, and one they must be able to
do carefully:

* **Find them** — a list filtered, sorted and faceted in SQL like every other
  list, off one `FieldSet` declaration (§71).
* **Understand their access** — not just "role: Manager", but the *effective*
  permission set, which is the role's plus every group's. A screen that shows
  the role alone cannot explain why somebody can cancel a job.
* **Change it** — role, status, groups — audited, in the same transaction.
* **See what they see** — impersonation, which `core/auth` already implements
  by header. What lives here is the part that decides *who may be
  impersonated*, because that is an authorization question rather than a
  transport one.

Credentials are not here and never will be: Keycloak owns them. This table
holds no password, and `mfa_enabled` mirrors the realm for display rather than
configuring it.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from src.core import audit
from src.core.auth import PERMISSION_LABELS
from src.core.clock import iso
from src.core.errors import ConflictError, NotFoundError, ValidationError
from src.core.naming import initials
from src.core.pagination import envelope, parse_page, parse_uuid
from src.core.query import Field, FieldSet, apply_filters, apply_sort, count_of, facets_for

VIEW_PERMISSION = "users.view"
MANAGE_PERMISSION = "users.manage"
IMPERSONATE_PERMISSION = "users.impersonate"

#: The states a person's account can be in. Free strings are refused: a status
#: nothing renders is a status nobody can act on.
STATUSES = ("ACTIVE", "INVITED", "SUSPENDED", "DISABLED")

#: Sessions and sign-ins shown on the detail page. It is a profile, not a log.
RECENT = 8


def _fields() -> FieldSet:
    from src.models.identity import Role, User

    return FieldSet(
        Field("full_name", User.full_name, searchable=True, label="Name"),
        Field("email", User.email, searchable=True),
        Field("username", User.username, searchable=True),
        Field("job_title", User.job_title, searchable=True, facet=True, label="Job title"),
        Field("status", User.status, kind="enum", facet=True, choices=STATUSES),
        Field("role_code", Role.code, kind="enum", facet=True, label="Role"),
        Field("mfa_enabled", User.mfa_enabled, kind="bool", label="MFA"),
        Field("last_login_at", User.last_login_at, kind="datetime", label="Last sign-in"),
        Field("login_count", User.login_count, kind="number", label="Sign-ins"),
        Field("profile_completeness", User.profile_completeness, kind="number",
              label="Profile complete"),
        Field("organization_id", User.organization_id, kind="uuid", label="Organization ID"),
        Field("department_id", User.department_id, kind="uuid", label="Department ID"),
        Field("id", User.id, kind="uuid", label="ID"),
        Field("created_at", User.created_at, kind="datetime", label="Created"),
        Field("updated_at", User.updated_at, kind="datetime", label="Updated"),
    )


DEFAULT_COLUMNS = ("full_name", "email", "role_code", "status", "last_login_at", "mfa_enabled")


def _statement():
    """Joined to `roles` so the role is filterable and sortable, not just shown.

    An outer join because a user without a role is still a user — and is
    exactly the row an administrator most wants to find.
    """
    from src.models.identity import Role, User

    return (
        select(User)
        .outerjoin(Role, User.role_id == Role.id)
        .where(User.deleted_at.is_(None))
        .options(selectinload(User.groups))
    )


def listing(session, args, *, principal) -> dict[str, Any]:
    principal.require(VIEW_PERMISSION)
    fields = _fields()
    page = parse_page(args, default_sort="full_name", default_order="asc")

    statement = apply_filters(_statement(), args, fields)
    total = count_of(session, statement)
    facets = facets_for(session, statement, fields)
    statement = apply_sort(statement, page, fields, default="full_name")
    rows = session.scalars(statement.offset(page.offset).limit(page.page_size)).unique().all()

    return envelope(
        [summarise(row) for row in rows],
        total,
        page,
        fields=fields.describe(),
        facets=facets,
        columns=list(DEFAULT_COLUMNS),
        statuses=list(STATUSES),
        can_manage=principal.can(MANAGE_PERMISSION),
        can_impersonate=principal.can(IMPERSONATE_PERMISSION),
    )


def access_of(user) -> dict[str, Any]:
    """The permissions a person actually has, and how they got them.

    Extracted because two screens need the same answer for different reasons:
    an administrator asks it of *somebody else* on `/admin/users/:id`, and a
    reader asks it of themselves on `/profile` — "why can I not export?" is
    the commonest support question there is, and until `/profile` existed the
    only place that answered it was a page the asker cannot open.

    Role *plus* groups, because that is what the API enforces. A screen showing
    only the role cannot explain why this person can cancel a job.
    """
    role_permissions = set(user.role.permissions or []) if user.role else set()
    group_permissions: dict[str, list[str]] = {
        group.name: sorted(group.permissions or []) for group in user.groups
    }
    effective = set(role_permissions)
    for permissions in group_permissions.values():
        effective.update(permissions)

    return {
        "role_permissions": sorted(role_permissions),
        "group_permissions": group_permissions,
        "effective": sorted(effective),
        "effective_labels": [PERMISSION_LABELS.get(p, p) for p in sorted(effective)],
        # Granted by a group and not by the role: the surprising half.
        "from_groups_only": sorted(effective - role_permissions),
    }


def groups_of(user) -> list[dict[str, Any]]:
    """The groups a person belongs to, with what each one grants."""
    return [
        {
            "id": str(group.id),
            "name": group.name,
            "kind": group.kind,
            "permissions": sorted(group.permissions or []),
        }
        for group in user.groups
    ]


def detail(session, user_id: Any, *, principal) -> dict[str, Any]:
    """One person, with the access they actually have and how they got it."""
    principal.require(VIEW_PERMISSION)
    user = _load(session, user_id)
    allowed, blocked_because = _may_impersonate(session, principal, user)

    return {
        **summarise(user),
        "phone": user.phone or "",
        "locale": user.locale,
        "timezone": user.timezone,
        "profile_completeness": user.profile_completeness,
        "organization": _named(user.organization),
        "department": _named(user.department),
        "manager": _named(user.manager),
        "groups": groups_of(user),
        "access": access_of(user),
        "sessions": _sessions(session, user),
        "sign_ins": _sign_ins(session, user),
        "can_manage": principal.can(MANAGE_PERMISSION),
        "can_impersonate": allowed,
        "impersonation_blocked_because": blocked_because,
    }


def update(session, user_id: Any, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    """Change a person's role, status or groups. Audited (§21)."""
    principal.require(MANAGE_PERMISSION)
    if not isinstance(payload, dict):
        raise ValidationError("The user must be a JSON object.")

    from src.models.identity import Group, Role

    user = _load(session, user_id)
    before = _state(user)
    changed = False

    if "status" in payload:
        status = str(payload["status"] or "").strip().upper()
        if status not in STATUSES:
            raise ValidationError(
                "Unknown account status.",
                details={"status": status, "allowed": list(STATUSES)},
            )
        if status != "ACTIVE" and user.id == principal.user_id:
            # Suspending yourself ends your own session on the next request,
            # and the screen that would undo it is behind that session.
            raise ConflictError(
                "You cannot suspend your own account.",
                details={"user_id": str(user.id)},
            )
        if status != user.status:
            user.status = status
            changed = True

    if "role_code" in payload:
        code = str(payload["role_code"] or "").strip()
        role = session.scalars(select(Role).where(Role.code == code)).first()
        if role is None:
            raise NotFoundError("That role does not exist.", details={"role_code": code})
        if user.id == principal.user_id and role.code != (user.role.code if user.role else ""):
            raise ConflictError(
                "You cannot change your own role. Ask another administrator.",
                details={"user_id": str(user.id)},
            )
        if user.role_id != role.id:
            user.role_id = role.id
            user.role = role
            changed = True

    if "group_ids" in payload:
        raw = payload["group_ids"]
        if not isinstance(raw, (list, tuple)):
            raise ValidationError("group_ids must be an array of ids")
        wanted = [parse_uuid(value, field="group_ids") for value in raw]
        groups = session.scalars(
            select(Group).where(Group.id.in_(wanted), Group.deleted_at.is_(None))
        ).unique().all() if wanted else []
        missing = sorted({str(value) for value in wanted} - {str(g.id) for g in groups})
        if missing:
            raise NotFoundError("Unknown group.", details={"group_ids": missing})
        if {g.id for g in groups} != {g.id for g in user.groups}:
            user.groups = list(groups)
            changed = True

    if changed:
        audit.record(
            session,
            action="PERMISSION_CHANGE" if "role_code" in payload or "group_ids" in payload
            else "STATUS_CHANGE",
            resource_type="user",
            resource_id=user.id,
            resource_label=user.full_name,
            principal=principal,
            before=before,
            after=_state(user),
            message=f"updated {user.full_name}",
        )
        session.flush()

    return detail(session, user.id, principal=principal)


def impersonation_target(session, user_id: Any, *, principal) -> dict[str, Any]:
    """Check that this person may be impersonated, and say who they are.

    The header in `core/auth` is the transport; this is the authorization.
    Answering it here — before a single impersonated request is made — is what
    lets the UI refuse in words rather than have every subsequent call fail.
    """
    principal.require(IMPERSONATE_PERMISSION)
    user = _load(session, user_id)

    allowed, reason = _may_impersonate(session, principal, user)
    if not allowed:
        raise ConflictError(reason, details={"user_id": str(user.id)})

    # Recorded when it *starts*, not only on each action taken: the fact that
    # an administrator viewed the platform as somebody else is itself the
    # event worth having (§12, §21).
    audit.record(
        session,
        action="IMPERSONATE",
        resource_type="user",
        resource_id=user.id,
        resource_label=user.full_name,
        principal=principal,
        after={"impersonating": user.username},
        message=f"started acting as {user.full_name}",
    )
    return {
        "id": str(user.id),
        "username": user.username,
        "full_name": user.full_name,
        "email": user.email,
        "role": user.role.code if user.role else None,
        "started_by": principal.full_name,
    }


def _may_impersonate(session, principal, user) -> tuple[bool, str]:
    """Whether `principal` may act as `user`, and why not when they may not.

    The rank check is the one that matters. Acting as somebody with *more*
    access than you have is privilege escalation wearing a costume: it would
    let a manager reach the administration area through a feature built for
    support. Ranks come from the same `roles` table the permission matrix
    edits, so raising a role's rank raises who may not be impersonated.
    """
    if not principal.can(IMPERSONATE_PERMISSION):
        return False, "You do not have permission to impersonate."
    if user.id == principal.user_id:
        return False, "You are already signed in as yourself."
    if user.status != "ACTIVE":
        return False, f"That account is {user.status.lower()}."

    own_rank = _role_rank(session, principal.role_code)
    target_rank = user.role.rank if user.role else 0
    if own_rank is not None and target_rank > own_rank:
        return False, "You cannot act as somebody with more access than you have."
    return True, ""


def _role_rank(session, code: str | None) -> int | None:
    """The rank of a role, or None when it is not in the table."""
    if not code:
        return None
    from src.models.identity import Role

    row = session.scalars(select(Role).where(Role.code == code)).first()
    return row.rank if row else None


# ── serialization ────────────────────────────────────────────────────────


def summarise(user) -> dict[str, Any]:
    return {
        "id": str(user.id),
        "email": user.email,
        "username": user.username,
        "full_name": user.full_name,
        "initials": initials(user.full_name),
        "avatar_url": user.avatar_url,
        "job_title": user.job_title or "",
        "status": user.status,
        "role_code": user.role.code if user.role else None,
        "role_name": user.role.name if user.role else "",
        "role_color": user.role.color if user.role else "",
        "mfa_enabled": bool(user.mfa_enabled),
        "last_login_at": iso(user.last_login_at),
        "login_count": user.login_count,
        "group_names": sorted(group.name for group in user.groups),
        "created_at": iso(user.created_at),
        "updated_at": iso(user.updated_at),
    }


def load_person(session, user_id: Any):
    """One person by id, with their groups, or a 404.

    Public because `/profile` (§40) needs the same row and the same refusal.
    A second loader would be a second answer to "does this person exist", and
    the two would eventually disagree about a soft-deleted account.
    """
    return _load(session, user_id)


def _load(session, user_id: Any):
    from src.models.identity import User

    identifier = parse_uuid(user_id, field="user_id")
    user = session.scalars(
        select(User)
        .options(selectinload(User.groups))
        .where(User.id == identifier, User.deleted_at.is_(None))
    ).unique().first()
    if user is None:
        raise NotFoundError("That user does not exist.", details={"id": str(identifier)})
    return user


def _sessions(session, user) -> list[dict[str, Any]]:
    from src.models.identity import UserSession

    rows = session.scalars(
        select(UserSession)
        .where(UserSession.user_id == user.id)
        .order_by(UserSession.last_seen_at.desc().nullslast())
        .limit(RECENT)
    ).all()
    return [
        {
            "id": str(row.id),
            "device": row.device or "",
            "ip_address": row.ip_address or "",
            "location": row.location or "",
            "last_seen_at": iso(row.last_seen_at),
            "revoked": row.revoked_at is not None,
            "trusted": bool(row.trusted),
        }
        for row in rows
    ]


def _sign_ins(session, user) -> list[dict[str, Any]]:
    from src.models.identity import LoginEvent

    rows = session.scalars(
        select(LoginEvent)
        .where(LoginEvent.user_id == user.id)
        .order_by(LoginEvent.created_at.desc())
        .limit(RECENT)
    ).all()
    return [
        {
            "id": str(row.id),
            "result": row.result,
            "reason": row.reason or "",
            "ip_address": row.ip_address or "",
            "location": row.location or "",
            "device": row.device or "",
            "method": row.method,
            "at": iso(row.created_at),
        }
        for row in rows
    ]


def _named(row) -> dict[str, Any] | None:
    if row is None:
        return None
    return {"id": str(row.id), "name": getattr(row, "name", None) or getattr(row, "full_name", "")}


def _state(user) -> dict[str, Any]:
    return {
        "status": user.status,
        "role": user.role.code if user.role else None,
        "groups": sorted(group.name for group in user.groups),
    }



