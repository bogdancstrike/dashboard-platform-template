"""Setting a group's members, and removing a group."""

from __future__ import annotations

from typing import Any

from sqlalchemy import select

from src.core import audit
from src.core.clock import now
from src.core.errors import ValidationError
from src.core.pagination import parse_uuid
from src.services.people.groups.checks import (
    MEMBERS_PERMISSION,
    VIEW_PERMISSION,
    summarise,
)
from src.services.people.groups.listing_view import _group


def set_members(session, group_id: str, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    """Put people in a group, or take them out.

    Takes the whole membership rather than a delta, so the request says what the
    group *is* and two administrators editing at once cannot interleave into a
    state neither chose. Effective immediately: `permissions_for` reads the
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
    # `permissions_for` walks the relationship and not the flag.
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
