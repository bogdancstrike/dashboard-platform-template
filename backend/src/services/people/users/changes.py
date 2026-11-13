"""Changing a user, and who may impersonate whom."""

from __future__ import annotations

from typing import Any

from sqlalchemy import select

from src.core import audit
from src.core.errors import ConflictError, NotFoundError, ValidationError
from src.core.pagination import parse_uuid
from src.core.repository import found_or_404
from src.services.people.users.directory_view import MANAGE_PERMISSION, STATUSES, detail
from src.services.people.users.impersonation import (
    IMPERSONATE_PERMISSION,
    _may_impersonate,
)
from src.services.people.users.serializers import _load, _state


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
        role = found_or_404(
            session.scalars(select(Role).where(Role.code == code)).first(),
            "That role does not exist.",
            details={"role_code": code},
        )
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
