"""Creating and removing roles; cleaning a permission list."""

from __future__ import annotations

from typing import Any

from sqlalchemy import func, select

from src.core import audit
from src.core.auth import ROLE_DEFAULTS
from src.core.errors import ConflictError, ValidationError
from src.core.repository import found_or_404
from src.services.people.roles.role_list import (
    _CODE,
    MANAGE_PERMISSION,
    MAX_DESCRIPTION,
    MAX_NAME,
    _clean_permissions,
)
from src.services.people.roles.serializers import _serialize, _state


def create(session, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    """A role of an installation's own.

    The gap this closes: the model has carried `is_system` since the beginning,
    every screen renders it, and there was no way to make a role that was not
    one — an administrator could edit the five the seed writes and nothing
    else. For an application *template*, "these are the only five roles you
    may ever have" is the wrong answer.

    A created role is never a system role, whatever the payload says: that flag
    is what protects the seeded five from being renamed or deleted, and letting
    a request set it would let a request opt out of the protection.
    """
    principal.require(MANAGE_PERMISSION)
    from src.models.identity import Role

    if not isinstance(payload, dict):
        raise ValidationError("The role must be a JSON object.")

    code = str(payload.get("code") or "").strip().upper()
    if not code:
        raise ValidationError("A role needs a code.")
    if not _CODE.fullmatch(code):
        raise ValidationError(
            "A role code is 2 to 48 characters: letters, digits and underscores.",
            details={"code": code},
        )
    if code in ROLE_DEFAULTS:
        raise ConflictError(
            f"{code} is one of the built-in roles. Edit it instead of replacing it.",
            details={"code": code},
        )
    if session.scalars(select(Role).where(Role.code == code)).first() is not None:
        raise ConflictError("A role with that code already exists.", details={"code": code})

    name = str(payload.get("name") or "").strip()
    if not name:
        raise ValidationError("A role needs a name.")
    if len(name) > MAX_NAME:
        raise ValidationError(f"A role name must be at most {MAX_NAME} characters.")

    role = Role(
        code=code,
        name=name,
        description=str(payload.get("description") or "").strip()[:MAX_DESCRIPTION] or None,
        permissions=_clean_permissions(payload.get("permissions")),
        # Below every seeded role, so a custom one cannot outrank the
        # administrator by accident. `rank` orders the matrix and is read
        # nowhere else, which is why this is a presentation decision.
        rank=int(payload.get("rank") or 10),
        color=str(payload.get("color") or "#64748b")[:16],
        is_system=False,
        is_default=False,
    )
    session.add(role)
    session.flush()
    audit.record(
        session,
        action="PERMISSION_CHANGE",
        resource_type="role",
        resource_id=role.id,
        resource_label=role.name,
        principal=principal,
        after=_state(role),
        message=f"created the {role.name} role",
    )
    return _serialize(role, 0, principal)


def remove(session, code: Any, *, principal) -> dict[str, Any]:
    """Delete a role an installation added.

    Two refusals, both worth the words. A **system** role cannot be deleted:
    the seed writes it, `--sync-roles` maintains it, and deleting one would
    leave `permissions_for` reading a row that comes back on the next deploy.
    And a role **somebody holds** cannot be deleted either, with the number
    named — a cascade would silently leave people with no permissions at all,
    which reads to them as the platform being broken.
    """
    principal.require(MANAGE_PERMISSION)
    from src.models.identity import Role, User

    role = found_or_404(
        session.scalars(select(Role).where(Role.code == str(code or ""))).first(),
        "That role does not exist.",
        details={"code": str(code or "")},
    )
    if role.is_system or role.code in ROLE_DEFAULTS:
        raise ConflictError(
            f"{role.name} is a built-in role. Its permissions can be changed; it cannot be removed.",
            details={"code": role.code},
        )
    if role.code == principal.role_code:
        raise ConflictError(
            "You cannot delete the role you are signed in with.",
            details={"code": role.code},
        )

    holders = int(
        session.scalar(
            select(func.count()).select_from(User).where(
                User.role_id == role.id, User.deleted_at.is_(None)
            )
        )
        or 0
    )
    if holders:
        raise ConflictError(
            f"{holders} {'person' if holders == 1 else 'people'} still hold "
            f"{role.name}. Move them to another role first.",
            details={"code": role.code, "holders": holders},
        )

    before = _state(role)
    audit.record(
        session,
        action="PERMISSION_CHANGE",
        resource_type="role",
        resource_id=role.id,
        resource_label=role.name,
        principal=principal,
        before=before,
        message=f"deleted the {role.name} role",
    )
    session.delete(role)
    session.flush()
    return {"deleted": True, "code": role.code}
