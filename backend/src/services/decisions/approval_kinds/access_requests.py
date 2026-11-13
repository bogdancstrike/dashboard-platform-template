"""Access requests: asking for a group, deciding, describing."""

from __future__ import annotations

from typing import Any

from sqlalchemy import select

from src.core import audit
from src.core.auth import ALL_PERMISSIONS, PERMISSION_LABELS
from src.core.errors import ConflictError, ValidationError
from src.core.repository import get_or_404
from src.models.approvals import ApprovalRequest
from src.services.decisions import approvals
from src.services.decisions.approvals import Provider

ACCESS_DECIDER = "roles.manage"


CHANGE_DECIDER = "approvals.decide"


OPERATORS = ("ANY", "EQUALS", "IN", "GT", "LT")


def _access_group(session, permission: str):
    from src.models.identity import Group

    slug = f"access-{permission.replace('.', '-')}"
    group = session.scalars(select(Group).where(Group.slug == slug)).first()
    if group is None:
        group = Group(
            name=f"Access: {PERMISSION_LABELS.get(permission, permission)}"[:120],
            slug=slug,
            description=f"Granted through approved access requests for {permission}.",
            kind="GOVERNANCE",
            permissions=[permission],
            color="#7c3aed",
        )
        session.add(group)
        session.flush()
    elif group.deleted_at is not None:
        group.deleted_at = None
    if permission not in (group.permissions or []):
        group.permissions = [*(group.permissions or []), permission]
    return group


def _apply_access(session, row: ApprovalRequest, *, approved: bool, principal, comment: str) -> None:
    if not approved:
        return
    from src.models.identity import User

    user = get_or_404(session, User, row.requester_id, "The person who asked no longer exists.")
    permission = (row.payload or {}).get("permission")
    group = _access_group(session, permission)
    if user not in group.members:
        group.members.append(user)
    session.flush()
    audit.record(
        session,
        action="PERMISSION_CHANGE",
        resource_type="group",
        resource_id=group.id,
        resource_label=group.name,
        principal=principal,
        after={"added_member": user.full_name, "permission": permission},
        message=f"granted {permission} to {user.full_name} through {row.reference}",
    )


def _describe_access(session, row: ApprovalRequest) -> dict[str, Any]:
    payload = row.payload or {}
    permission = payload.get("permission", "")
    return {
        "facts": [
            {"label": "Permission", "value": PERMISSION_LABELS.get(permission, permission)},
            {"label": "Code", "value": permission},
            {"label": "Asked from", "value": payload.get("path") or "—"},
            {"label": "Granted through", "value": f"Access: {PERMISSION_LABELS.get(permission, permission)} group"},
        ]
    }


def request_access(session, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    """Ask for a permission from a page that needed it."""
    permission = str(payload.get("permission") or "").strip()
    if permission not in ALL_PERMISSIONS:
        raise ValidationError(f"{permission!r} is not a permission.", details={"field": "permission"})
    if principal.can(permission):
        raise ConflictError("You already have this permission.", details={"permission": permission})
    reason = str(payload.get("reason") or "").strip()[:1000]
    path = str(payload.get("path") or "").strip()[:300]
    existing = session.scalars(
        select(ApprovalRequest).where(
            ApprovalRequest.kind == "access",
            ApprovalRequest.requester_id == principal.user_id,
            ApprovalRequest.status == "PENDING",
            ApprovalRequest.subject_id == permission,
        )
    ).first()
    if existing is not None:
        return {**approvals.serialize(existing, principal=principal), "already_pending": True}
    label = PERMISSION_LABELS.get(permission, permission)
    row = approvals.submit(
        session,
        kind="access",
        requester_id=principal.user_id,
        requester_label=principal.full_name,
        title=f"Access: {label}",
        summary=reason or f"Asked for from {path or 'a page that needed it'}.",
        subject_type="permission",
        subject_id=permission,
        subject_label=label,
        link=path or None,
        payload={"permission": permission, "path": path, "reason": reason},
    )
    return {**approvals.serialize(row, principal=principal), "already_pending": False}


approvals.register(Provider(kind="access", label="Access requests", icon="key",
                            decide_permission=ACCESS_DECIDER, sla_hours=24, apply=_apply_access,
                            describe=_describe_access))
