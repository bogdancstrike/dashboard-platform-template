"""Groups (§11): sets of people, and the permissions being in one adds.

A group is not a role. A role is the one thing a person *is*, and everybody has
exactly one; a group is something a person is *in*, and they can be in several.
`core/auth._permissions_for` unions every group's permissions onto the role's,
which is what makes this screen change real behaviour rather than describe an
org chart.

Four decisions worth stating, and the first is the one that matters most.

**Managing membership and managing grants are different privileges.** Editing
who is in a group needs `users.manage`; editing what a group *grants* needs
`roles.manage`. Without that split, `users.manage` would be a
privilege-escalation path to everything: a manager holds it, does not hold
`roles.manage`, and could otherwise add `roles.manage` to a group they are in
and have it on their next request. The same page therefore has two privilege
levels because two of its fields have very different consequences, and
`test_groups` asserts the escalation is refused rather than merely undocumented.

**A grant is checked against the permission catalogue.** A group that grants
`records.expport` grants nothing at all, and looks in every screen exactly like
one that works — so an unknown code is refused with the near-misses named,
rather than stored.

**Deleting a group is allowed, and says what it costs.** Not refused while
occupied like a role is: a role is somebody's identity and a group is a set, the
model is soft-delete so it is recoverable, and refusing would mean emptying a
group of forty by hand first. What it must not do is take permissions away
silently, so the response names how many people were affected and which
permissions they lose with it.

**A group's own name is the only thing that names it.** The slug is derived,
because two places to write "on-call" is two places for them to disagree — and
the slug is what a URL and an integration hold on to.
"""

from __future__ import annotations

import re
from typing import Any

from sqlalchemy import Select, func, select

from src.core import audit, vocabulary
from src.core.auth import ALL_PERMISSIONS, PERMISSION_LABELS
from src.core.clock import iso, now
from src.core.errors import ConflictError, NotFoundError, ValidationError
from src.core.naming import initials
from src.core.pagination import envelope, parse_page, parse_uuid
from src.core.query import Field, FieldSet, apply_filters, apply_sort, count_of, facets_for

#: Reading who is in what. The same permission the user list needs, because a
#: group's membership is directory information.
VIEW_PERMISSION = "users.view"

#: Changing membership, and creating or removing a group.
MEMBERS_PERMISSION = "users.manage"

#: Changing what a group *grants*. Deliberately the permission that governs the
#: role matrix: editing a group's permissions is granting permissions, and
#: giving that away with `users.manage` would make `users.manage` mean
#: everything. See the module docstring.
GRANTS_PERMISSION = "roles.manage"

#: A group name has to fit a chip, a heading and a filter menu.
_NAME = re.compile(r"^[\w][\w \-&'/().]{1,79}$", re.UNICODE)

#: How many members one group's detail carries. A group is a set somebody
#: manages, not a directory — `/admin/users` filtered by group is the place to
#: read a long one.
MAX_MEMBERS = 200


def _fields() -> FieldSet:
    """Built lazily so importing this module does not pull the models at boot."""
    from src.models.identity import Group

    return FieldSet(
        Field("name", Group.name, searchable=True),
        Field("slug", Group.slug, searchable=True),
        Field("description", Group.description, searchable=True),
        Field("kind", Group.kind, kind="enum", facet=True, choices=vocabulary.GROUP_KIND),
        Field("permissions", Group.permissions, kind="array", label="Grants"),
        Field("created_at", Group.created_at, kind="datetime", label="Created"),
        Field("id", Group.id, kind="uuid", label="Group ID"),
    )


DEFAULT_COLUMNS = ("name", "kind", "permissions", "members")


def _statement() -> Select:
    from src.models.identity import Group

    return select(Group).where(Group.deleted_at.is_(None))


def _slug(name: str) -> str:
    """The stable handle for a name.

    Derived rather than asked for: a URL and an integration hold on to a slug,
    and two places to write "on-call" is two places for them to disagree.
    """
    cleaned = re.sub(r"[^a-z0-9]+", "-", name.strip().lower()).strip("-")
    return cleaned or "group"


def _checked_name(value: Any) -> str:
    name = str(value or "").strip()
    if not _NAME.match(name):
        raise ValidationError(
            "A group needs a name of 2 to 80 characters, letters or digits first.",
            details={"value": name},
        )
    return name


def _checked_kind(value: Any) -> str:
    kind = str(value or "TEAM").strip().upper()
    if kind not in vocabulary.GROUP_KIND:
        raise ValidationError(
            f"{kind!r} is not a kind of group.",
            details={"value": kind, "allowed": list(vocabulary.GROUP_KIND)},
        )
    return kind


def _checked_grants(value: Any) -> list[str]:
    """The permissions a group may grant, refusing anything unrecognised.

    A group granting `records.expport` grants nothing, and looks identical in
    every screen to one that works — the quietest possible way to believe
    somebody has access they do not. The near-misses are named because the
    cause is almost always a typo.
    """
    if value is None:
        return []
    if not isinstance(value, list):
        raise ValidationError("permissions must be a list of permission codes.")

    wanted = [str(item).strip() for item in value if str(item).strip()]
    unknown = [code for code in wanted if code not in ALL_PERMISSIONS]
    if unknown:
        raise ValidationError(
            f"No endpoint checks for {', '.join(sorted(unknown))}.",
            details={
                "unknown": sorted(unknown),
                "did_you_mean": sorted(
                    {
                        known
                        for code in unknown
                        for known in ALL_PERMISSIONS
                        if known.split(".")[0] == code.split(".")[0]
                    }
                )[:6],
            },
        )
    # Ordered and deduplicated, so two groups granting the same set store the
    # same array and a diff between them is about the permissions.
    return sorted(set(wanted))


def summarise(row, *, members: int = 0) -> dict[str, Any]:
    """One group, as a table row."""
    return {
        "id": str(row.id),
        "name": row.name,
        "slug": row.slug,
        "description": row.description,
        "kind": row.kind,
        "color": row.color,
        "permissions": list(row.permissions or []),
        "member_count": members,
        "created_at": iso(row.created_at),
        "updated_at": iso(row.updated_at),
    }


def catalogue(session, *, principal) -> dict[str, Any]:
    """The vocabulary the group editor is built from.

    Ships the *permission catalogue* too, so the grants editor offers exactly
    what the code checks for — the same reason the role matrix reads it rather
    than listing permissions of its own.
    """
    principal.require(VIEW_PERMISSION)
    from src.models.identity import Group

    counted = dict(
        session.execute(
            select(Group.kind, func.count())
            .where(Group.deleted_at.is_(None))
            .group_by(Group.kind)
        ).all()
    )
    return {
        "fields": _fields().describe(),
        "default_columns": list(DEFAULT_COLUMNS),
        "kinds": [
            {"key": kind, "count": int(counted.get(kind, 0))}
            for kind in vocabulary.GROUP_KIND
        ],
        "permissions": [
            {"code": code, "label": PERMISSION_LABELS.get(code, code)}
            for code in ALL_PERMISSIONS
        ],
        "total": count_of(session, _statement()),
        # The two privileges this page needs, answered once rather than
        # guessed at per control.
        "can_manage_members": principal.can(MEMBERS_PERMISSION),
        "can_manage_grants": principal.can(GRANTS_PERMISSION),
    }


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

    row = session.get(Group, parse_uuid(group_id, field="id"))
    if row is None or row.deleted_at is not None:
        raise NotFoundError("That group does not exist.")
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


def update(session, group_id: str, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    """Rename or re-describe a group. Its grants are `set_grants`.

    Split on purpose: this endpoint is `users.manage`, and if it also took
    `permissions` then `users.manage` would grant everything. A payload that
    includes them is refused rather than ignored, because silently dropping a
    field somebody submitted is how a UI comes to believe it saved something.
    """
    principal.require(VIEW_PERMISSION, MEMBERS_PERMISSION)
    row = _group(session, group_id)

    if "permissions" in payload:
        raise ValidationError(
            "What a group grants is changed on its own, and needs "
            f"`{GRANTS_PERMISSION}`.",
            details={"field": "permissions", "requires": GRANTS_PERMISSION},
        )

    before = {"name": row.name, "kind": row.kind, "description": row.description}
    if "name" in payload:
        row.name = _checked_name(payload.get("name"))
    if "kind" in payload:
        row.kind = _checked_kind(payload.get("kind"))
    if "description" in payload:
        row.description = str(payload.get("description") or "").strip() or None
    if "color" in payload:
        row.color = str(payload.get("color") or row.color)

    # The slug follows the name, so the handle keeps matching what the group is
    # called — and a rename that collided would silently break whatever holds
    # the old one, so it is refused.
    if row.name != before["name"]:
        wanted = _slug(row.name)
        if wanted != row.slug:
            from src.models.identity import Group

            clash = session.scalar(
                select(Group).where(
                    Group.slug == wanted, Group.id != row.id, Group.deleted_at.is_(None)
                )
            )
            if clash is not None:
                raise ConflictError(
                    f"Renaming this to {row.name!r} would collide with {clash.name!r}.",
                    details={"slug": wanted},
                )
            row.slug = wanted

    audit.record(
        session,
        action="UPDATE",
        resource_type="group",
        resource_id=row.id,
        resource_label=row.name,
        principal=principal,
        before=before,
        after={"name": row.name, "kind": row.kind, "description": row.description},
        message=f"edited the group {row.name}",
    )
    session.flush()
    counts = _member_counts(session, [row.id])
    return summarise(row, members=counts.get(row.id, 0))


def set_grants(session, group_id: str, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    """Change what being in this group adds.

    `roles.manage`, and that is the whole point: this is granting permissions.
    A manager holds `users.manage` and not this, so they cannot add
    `roles.manage` to a group they are in and have it on their next request —
    which is what `users.manage` would otherwise be worth.
    """
    principal.require(VIEW_PERMISSION, GRANTS_PERMISSION)
    row = _group(session, group_id)

    wanted = _checked_grants(payload.get("permissions"))
    before = list(row.permissions or [])
    if wanted == sorted(before):
        return summarise(row, members=_member_counts(session, [row.id]).get(row.id, 0))

    row.permissions = wanted
    added = sorted(set(wanted) - set(before))
    removed = sorted(set(before) - set(wanted))

    audit.record(
        session,
        action="UPDATE",
        resource_type="group",
        resource_id=row.id,
        resource_label=row.name,
        principal=principal,
        before={"permissions": before},
        after={"permissions": wanted},
        # Spelled out, because "the permissions changed" is the one audit
        # message nobody can act on.
        message=(
            f"{row.name} now grants "
            + (f"+{', '.join(added)} " if added else "")
            + (f"-{', '.join(removed)}" if removed else "")
        ).strip(),
    )
    session.flush()
    counts = _member_counts(session, [row.id])
    return {
        **summarise(row, members=counts.get(row.id, 0)),
        "added": added,
        "removed": removed,
    }


def set_members(session, group_id: str, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    """Put people in a group, or take them out.

    Takes the whole membership rather than a delta, so the request says what the
    group *is* and two administrators editing at once cannot interleave into a
    state neither chose. Effective immediately: `_permissions_for` reads the
    table on every request, so somebody added here has the group's permissions
    on their next call without signing in again.
    """
    principal.require(VIEW_PERMISSION, MEMBERS_PERMISSION)
    from src.models.identity import User

    row = _group(session, group_id)
    raw = payload.get("user_ids")
    if not isinstance(raw, list):
        raise ValidationError("user_ids must be a list of user ids.")

    wanted = [parse_uuid(str(item), field="user_ids") for item in raw]
    users = list(
        session.scalars(
            select(User).where(User.id.in_(wanted), User.deleted_at.is_(None))
        ).all()
    ) if wanted else []

    missing = sorted(set(wanted) - {user.id for user in users})
    if missing:
        raise ValidationError(
            "Some of those people do not exist.",
            details={"unknown": [str(item) for item in missing]},
        )

    before = {user.id for user in row.members}
    row.members = users
    after = {user.id for user in users}

    audit.record(
        session,
        action="UPDATE",
        resource_type="group",
        resource_id=row.id,
        resource_label=row.name,
        principal=principal,
        before={"member_count": len(before)},
        after={"member_count": len(after)},
        message=(
            f"{row.name} membership: "
            f"{len(after - before)} added, {len(before - after)} removed"
        ),
    )
    session.flush()
    return {
        **summarise(row, members=len(users)),
        "added": len(after - before),
        "removed": len(before - after),
    }


def remove(session, group_id: str, *, principal) -> dict[str, Any]:
    """Retire a group, saying what it costs.

    Allowed while occupied, unlike a role: a role is somebody's identity and
    there is exactly one, a group is a set and the model is soft-delete, so
    refusing would only mean emptying a group of forty by hand first. What it
    must not do is quietly reduce anybody's access, so the answer names how
    many people were in it and which permissions they lose with it.
    """
    principal.require(VIEW_PERMISSION, MEMBERS_PERMISSION)
    row = _group(session, group_id)

    members = [user for user in row.members if user.deleted_at is None]
    withdrawn = list(row.permissions or [])
    label = row.name

    row.deleted_at = now()
    # Emptied as well as retired: a soft-deleted group whose rows stayed in
    # `user_groups` would keep granting its permissions, since
    # `_permissions_for` walks the relationship and not the flag.
    row.members = []

    audit.record(
        session,
        action="DELETE",
        resource_type="group",
        resource_id=row.id,
        resource_label=label,
        principal=principal,
        before={"member_count": len(members), "permissions": withdrawn},
        message=(
            f"removed the group {label}"
            + (f", withdrawing {', '.join(withdrawn)} from {len(members)} people" if withdrawn and members else "")
        ),
    )
    session.flush()
    return {
        "deleted": True,
        "id": str(row.id),
        "name": label,
        "members_affected": len(members),
        "permissions_withdrawn": withdrawn,
    }
