"""Groups: list, one group, create."""

from __future__ import annotations

from typing import Any

from sqlalchemy import func, select

from src.core import audit
from src.core.errors import ConflictError
from src.core.naming import initials
from src.core.pagination import envelope, parse_page, parse_uuid
from src.core.query import apply_filters, apply_sort, count_of, facets_for
from src.core.repository import get_or_404
from src.services.people.groups.checks import (
    DEFAULT_COLUMNS,
    GRANTS_PERMISSION,
    MAX_MEMBERS,
    MEMBERS_PERMISSION,
    VIEW_PERMISSION,
    _checked_kind,
    _checked_name,
    _fields,
    _slug,
    _statement,
    summarise,
)


def _member_counts(session, ids: list[Any]) -> dict[Any, int]:
    """Members per group, in one query.

    A page of twenty groups should not be twenty counts — and a relationship
    length read per row is exactly that, with the rows loaded as well.
    """
    from src.models.identity import user_groups

    if not ids:
        return {}
    rows = session.execute(
        select(user_groups.c.group_id, func.count())
        .where(user_groups.c.group_id.in_(ids))
        .group_by(user_groups.c.group_id)
    ).all()
    return {group_id: int(count) for group_id, count in rows}


def listing(session, args, *, principal) -> dict[str, Any]:
    """One page of groups, filtered and faceted in PostgreSQL (§71)."""
    principal.require(VIEW_PERMISSION)
    fields = _fields()
    page = parse_page(args, default_sort="name", default_order="asc")

    statement = apply_filters(_statement(), args, fields)
    total = count_of(session, statement)
    facets = facets_for(session, statement, fields)
    statement = apply_sort(statement, page, fields, default="name")
    rows = session.scalars(statement.offset(page.offset).limit(page.page_size)).all()

    counts = _member_counts(session, [row.id for row in rows])
    return envelope(
        [summarise(row, members=counts.get(row.id, 0)) for row in rows],
        total,
        page,
        fields=fields.describe(),
        facets=facets,
        columns=list(DEFAULT_COLUMNS),
        can_manage_members=principal.can(MEMBERS_PERMISSION),
        can_manage_grants=principal.can(GRANTS_PERMISSION),
    )


def _group(session, group_id: str):
    from src.models.identity import Group

    row = get_or_404(
        session, Group, parse_uuid(group_id, field="id"), "That group does not exist.", live=True
    )
    return row


def entry(session, group_id: str, *, principal) -> dict[str, Any]:
    """One group, with the people in it."""
    principal.require(VIEW_PERMISSION)
    row = _group(session, group_id)

    members = [
        {
            "id": str(user.id),
            "full_name": user.full_name,
            # From `core/naming`, not computed in the browser: that function
            # exists because the rule was written twice and the two copies
            # disagreed about middle names, so one person had two avatars.
            "initials": initials(user.full_name),
            "email": user.email,
            "username": user.username,
            "avatar_url": user.avatar_url,
            "status": user.status,
            "role_code": user.role.code if user.role else None,
            "job_title": user.job_title,
        }
        for user in sorted(
            (user for user in row.members if user.deleted_at is None),
            key=lambda user: user.full_name or "",
        )[:MAX_MEMBERS]
    ]
    return {
        **summarise(row, members=len(members)),
        "members": members,
        "member_overflow": max(0, len([u for u in row.members if u.deleted_at is None]) - MAX_MEMBERS),
    }


def create(session, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    """Make a group. It grants nothing until somebody with `roles.manage` says so.

    Two permissions would be needed to create a group *with* grants, so a
    creation never carries them: whoever may add people makes the group, and
    whoever may grant permissions fills them in. That keeps the create form one
    privilege level rather than an unpredictable two.
    """
    principal.require(VIEW_PERMISSION, MEMBERS_PERMISSION)
    from src.models.identity import Group

    name = _checked_name(payload.get("name"))
    kind = _checked_kind(payload.get("kind"))
    slug = _slug(name)

    clash = session.scalar(
        select(Group).where(Group.slug == slug, Group.deleted_at.is_(None))
    )
    if clash is not None:
        raise ConflictError(
            f"A group called {clash.name!r} already uses the handle {slug!r}.",
            details={"slug": slug, "existing": str(clash.id)},
        )

    row = Group(
        name=name,
        slug=slug,
        kind=kind,
        description=str(payload.get("description") or "").strip() or None,
        color=str(payload.get("color") or "#0891b2"),
        # Never on creation, whatever the payload says — see the docstring.
        permissions=[],
    )
    session.add(row)
    session.flush()

    audit.record(
        session,
        action="CREATE",
        resource_type="group",
        resource_id=row.id,
        resource_label=row.name,
        principal=principal,
        after={"name": row.name, "kind": row.kind, "slug": row.slug},
        message=f"created the group {row.name}",
    )
    return summarise(row)
