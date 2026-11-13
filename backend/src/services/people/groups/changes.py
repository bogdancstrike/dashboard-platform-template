"""Changing a group and its grants."""

from __future__ import annotations

from typing import Any

from sqlalchemy import select

from src.core import audit
from src.core.errors import ConflictError, ValidationError
from src.services.people.groups.checks import (
    GRANTS_PERMISSION,
    MEMBERS_PERMISSION,
    VIEW_PERMISSION,
    _checked_grants,
    _checked_kind,
    _checked_name,
    _slug,
    summarise,
)
from src.services.people.groups.listing_view import _group, _member_counts


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
