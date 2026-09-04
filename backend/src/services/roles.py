"""Roles and the permission matrix (§13).

The matrix is the screen that explains the whole authorization model, so it is
built from the two things that actually decide access rather than from a
description of them:

* the **permission catalogue** in `core/auth.py`, which is the list of things
  the code checks for — so every permission an endpoint can require appears on
  the screen that grants it, and one that does not exist cannot be granted;
* the **`roles` table**, which `_permissions_for` reads on every request — so
  an edit here changes what the next request is allowed to do, with no
  re-login and no cache to invalidate.

`/meta/roles` publishes the *defaults* the seed writes. This publishes what is
actually in force. A screen that showed the defaults while the database said
something else would be worse than no screen.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import func, select

from src.core import audit
from src.core.auth import (
    ALL_PERMISSIONS,
    PERMISSION_GROUPS,
    PERMISSION_LABELS,
    ROLE_DEFAULTS,
)
from src.core.errors import ConflictError, NotFoundError, ValidationError

VIEW_PERMISSION = "roles.manage"
MANAGE_PERMISSION = "roles.manage"

#: Permissions that may never be taken from the caller's own role.
#:
#: Removing `roles.manage` from the role you are signed in with is a change
#: that cannot be undone from inside the application: the screen that would
#: undo it is the screen you have just locked yourself out of. The database is
#: then the only way back, which is not an administration model.
SELF_LOCKOUT_GUARD = ("roles.manage", "admin.access")

#: What a name and description may be, so the matrix stays readable.
MAX_NAME = 96
MAX_DESCRIPTION = 500


def catalogue() -> dict[str, Any]:
    """Every permission the code checks for, grouped as the matrix renders it."""
    return {
        "groups": [
            {
                "name": group,
                "permissions": [{"code": code, "label": label} for code, label in entries],
            }
            for group, entries in PERMISSION_GROUPS.items()
        ],
        "total": len(ALL_PERMISSIONS),
    }


def listing(session, *, principal) -> dict[str, Any]:
    """The roles in force, with what each grants and how many people hold it."""
    principal.require(VIEW_PERMISSION)
    from src.models.identity import Role, User

    counts = dict(
        session.execute(
            select(User.role_id, func.count())
            .where(User.deleted_at.is_(None))
            .group_by(User.role_id)
        ).all()
    )
    rows = session.scalars(select(Role).order_by(Role.rank.desc())).all()

    return {
        "items": [_serialize(row, counts.get(row.id, 0), principal) for row in rows],
        "total": len(rows),
        "permissions": catalogue(),
        "your_role": principal.role_code,
    }


def update(session, code: Any, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    """Change what a role grants. Audited, in the same transaction (§21)."""
    principal.require(MANAGE_PERMISSION)
    from src.models.identity import Role, User

    if not isinstance(payload, dict):
        raise ValidationError("The role must be a JSON object.")

    role = session.scalars(select(Role).where(Role.code == str(code or ""))).first()
    if role is None:
        raise NotFoundError("That role does not exist.", details={"code": str(code or "")})

    before = _state(role)
    changed = False

    if "permissions" in payload:
        granted = _clean_permissions(payload["permissions"])
        if role.code == principal.role_code:
            removed = [p for p in SELF_LOCKOUT_GUARD if p in role.permissions and p not in granted]
            if removed:
                raise ConflictError(
                    "You cannot remove your own ability to administer roles. "
                    "Ask another administrator to make this change.",
                    details={"role": role.code, "would_remove": removed},
                )
        if set(granted) != set(role.permissions or []):
            role.permissions = granted
            changed = True

    if "name" in payload:
        name = str(payload["name"] or "").strip()
        if not name:
            raise ValidationError("A role needs a name.")
        if len(name) > MAX_NAME:
            raise ValidationError(f"A role name must be at most {MAX_NAME} characters.")
        if name != role.name:
            role.name = name
            changed = True

    if "description" in payload:
        description = str(payload["description"] or "").strip()[:MAX_DESCRIPTION]
        if description != (role.description or ""):
            role.description = description
            changed = True

    if changed:
        # In the same transaction as the change, so a rolled-back edit cannot
        # leave an audit row claiming it happened.
        audit.record(
            session,
            action="PERMISSION_CHANGE",
            resource_type="role",
            resource_id=role.id,
            resource_label=role.name,
            principal=principal,
            before=before,
            after=_state(role),
            message=f"updated the {role.name} role",
        )
        session.flush()

    holders = session.scalar(
        select(func.count()).select_from(User).where(
            User.role_id == role.id, User.deleted_at.is_(None)
        )
    ) or 0
    return _serialize(role, int(holders), principal)


def _clean_permissions(raw: Any) -> list[str]:
    """Only permissions the code actually checks for, de-duplicated and sorted.

    Refusing an unknown one is the point: a role granting `reports.publish`
    when nothing checks for it reads on the matrix as a capability the holder
    does not have, which is the most misleading thing an access screen can do.
    """
    if not isinstance(raw, (list, tuple)):
        raise ValidationError("permissions must be an array of permission codes")
    codes = {str(item).strip() for item in raw if str(item).strip()}
    unknown = sorted(code for code in codes if code not in ALL_PERMISSIONS)
    if unknown:
        raise ValidationError(
            "Unknown permission.",
            details={"permissions": unknown, "known": sorted(ALL_PERMISSIONS)},
        )
    return sorted(codes)


def _state(role) -> dict[str, Any]:
    return {
        "name": role.name,
        "description": role.description or "",
        "permissions": sorted(role.permissions or []),
    }


def _serialize(role, holders: int, principal) -> dict[str, Any]:
    permissions = sorted(role.permissions or [])
    default = ROLE_DEFAULTS.get(role.code, {})
    return {
        "id": str(role.id),
        "code": role.code,
        "name": role.name,
        "description": role.description or "",
        "rank": role.rank,
        "color": role.color,
        "is_system": bool(role.is_system),
        "is_default": bool(role.is_default),
        "permissions": permissions,
        "permission_labels": [PERMISSION_LABELS.get(p, p) for p in permissions],
        "user_count": holders,
        # What the seed would have written, so the screen can show that a role
        # has been changed from its shipped defaults — and what from.
        "default_permissions": sorted(default.get("permissions", [])),
        "customised": sorted(default.get("permissions", [])) != permissions,
        #: True for the role the caller themselves holds. The UI marks it,
        #: because editing your own permissions is the edit most likely to be
        #: made by accident.
        "is_yours": role.code == principal.role_code,
    }
