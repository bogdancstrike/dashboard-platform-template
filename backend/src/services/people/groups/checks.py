"""Group fields, columns, and the checks names, kinds and grants pass."""

from __future__ import annotations

import re
from typing import Any

from sqlalchemy import Select, func, select

from src.core import vocabulary
from src.core.auth import ALL_PERMISSIONS, PERMISSION_LABELS
from src.core.clock import iso
from src.core.errors import ValidationError
from src.core.query import Field, FieldSet, count_of

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
