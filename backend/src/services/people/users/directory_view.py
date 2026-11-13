"""User permissions and columns, the list, access and groups, one user."""

from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from src.core.auth import PERMISSION_LABELS
from src.core.pagination import envelope, parse_page
from src.core.query import (
    Field,
    FieldSet,
    apply_filters,
    apply_sort,
    count_of,
    facets_for,
)
from src.services.people.users.impersonation import (
    IMPERSONATE_PERMISSION,
    _may_impersonate,
)
from src.services.people.users.serializers import (
    _load,
    _named,
    _sessions,
    _sign_ins,
    summarise,
)

VIEW_PERMISSION = "users.view"


MANAGE_PERMISSION = "users.manage"


#: The states a person's account can be in. Free strings are refused: a status
#: nothing renders is a status nobody can act on.
STATUSES = ("ACTIVE", "INVITED", "SUSPENDED", "DISABLED")


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
