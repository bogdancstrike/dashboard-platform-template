"""Creating and removing flags, their history, and a targeting preview."""

from __future__ import annotations

from typing import Any

from sqlalchemy import select

from src.core import audit
from src.core.clock import iso
from src.core.errors import ConflictError, ValidationError
from src.core.pagination import parse_uuid
from src.core.repository import get_or_404
from src.models.platform import FeatureFlag
from src.services.platform.settings.flag_list import _flag_row
from src.services.platform.settings.flag_state import _flag, _flag_state
from src.services.platform.settings.system_settings import FLAGS_PERMISSION, MAX_KEY


def create_flag(session, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    """A flag of this installation's own, off by default.

    Off, always: a flag that arrived enabled would ship whatever it guards at
    the moment it was created, which is the opposite of what a flag is for.
    """
    principal.require(FLAGS_PERMISSION)
    data = payload if isinstance(payload, dict) else {}

    key = str(data.get("key") or "").strip().lower().replace(" ", "-")
    if not key or len(key) > MAX_KEY:
        raise ValidationError(f"A flag needs a key of 1 to {MAX_KEY} characters.")
    if session.scalar(select(FeatureFlag.id).where(FeatureFlag.key == key)) is not None:
        raise ConflictError("A flag with that key already exists.", details={"key": key})

    name = str(data.get("name") or "").strip()
    if not name:
        raise ValidationError("A flag needs a name.")

    row = FeatureFlag(
        key=key,
        name=name[:160],
        description=str(data.get("description") or "").strip()[:2000] or None,
        enabled=False,
        environment=str(data.get("environment") or "production")[:24],
        stage=str(data.get("stage") or "BETA").upper()[:24],
        rollout_percentage=0,
        owner_id=getattr(principal, "user_id", None),
        updated_by_id=getattr(principal, "user_id", None),
        experimental=bool(data.get("experimental", True)),
    )
    session.add(row)
    session.flush()
    audit.record(
        session,
        action="FLAG_CHANGE",
        resource_type="feature_flag",
        resource_id=row.id,
        resource_label=row.name,
        principal=principal,
        after=_flag_state(row),
        message=f"created the {row.name} flag, off",
    )
    return _flag(row, principal)


def remove_flag(session, key: Any, *, principal) -> dict[str, Any]:
    """Delete a flag.

    Refused while it is *on*: removing a flag that something is reading turns
    a guarded feature into an unguarded one, and the person who deletes it is
    rarely the person who finds out. Turn it off, watch, then remove it.
    """
    principal.require(FLAGS_PERMISSION)
    row = _flag_row(session, key)
    if row.enabled:
        raise ConflictError(
            f"{row.name} is on. Turn it off first — deleting a live flag ships "
            "whatever it guards to everybody.",
            details={"key": row.key},
        )

    audit.record(
        session,
        action="FLAG_CHANGE",
        resource_type="feature_flag",
        resource_id=row.id,
        resource_label=row.name,
        principal=principal,
        before=_flag_state(row),
        message=f"deleted the {row.name} flag",
    )
    session.delete(row)
    session.flush()
    return {"deleted": True, "key": row.key}


def flag_history(session, key: Any, args, *, principal) -> dict[str, Any]:
    """Every recorded change to one flag, newest first — who, when, from what to what."""
    from src.models.platform import AuditLog

    principal.require(FLAGS_PERMISSION)
    row = _flag_row(session, key)
    try:
        limit = max(1, min(int((args or {}).get("limit") or 50), 200))
    except (TypeError, ValueError):
        limit = 50
    entries = session.scalars(
        select(AuditLog)
        .where(AuditLog.resource_type == "feature_flag", AuditLog.resource_id == str(row.id))
        .order_by(AuditLog.occurred_at.desc())
        .limit(limit)
    ).all()
    return {
        "key": row.key,
        "items": [
            {
                "id": str(entry.id),
                "at": iso(entry.occurred_at),
                "actor": entry.actor_label,
                "actor_id": str(entry.actor_id) if entry.actor_id else None,
                "message": entry.message,
                "before": entry.state_before,
                "after": entry.state_after,
                "changed_fields": list(entry.changed_fields or []),
            }
            for entry in entries
        ],
    }


def preview(session, args, *, principal) -> dict[str, Any]:
    """What a role (optionally one person, group or organization) would see.

    Evaluated with the same rule `/api/me` uses, against a stand-in reader.
    Percentage rollouts depend on *who* the person is, so without one they are
    reported in `depends_on_person` rather than guessed.
    """
    from types import SimpleNamespace

    from src.core import features
    from src.models.identity import Role, User

    principal.require(FLAGS_PERMISSION)
    data = args or {}
    role_code = str(data.get("role") or "").strip().upper() or None
    user_id = None
    organization_id = str(data.get("organization_id") or "").strip() or None
    groups = tuple(item for item in str(data.get("group") or "").split(",") if item.strip())
    if data.get("user_id"):
        user = get_or_404(
            session,
            User,
            parse_uuid(data["user_id"], field="user_id"),
            "That person does not exist.",
        )
        user_id = user.id
        organization_id = organization_id or (str(user.organization_id) if user.organization_id else None)
        if role_code is None and user.role_id:
            role = session.get(Role, user.role_id)
            role_code = role.code if role else None
        groups = groups + tuple(group.name for group in user.groups)
    if role_code is None:
        raise ValidationError("Preview needs a role or a person.")
    reader = SimpleNamespace(
        user_id=user_id, role_code=role_code, groups=groups, organization_id=organization_id
    )
    states = features.snapshot()
    resolved = features.enabled_map(reader, states)
    depends = sorted(
        key for key, state in states.items()
        if user_id is None and state.enabled and 0 < state.rollout_percentage < 100
        and not resolved.get(key)
    )
    return {
        "role": role_code,
        "user_id": str(user_id) if user_id else None,
        "features": resolved,
        "off": sorted(key for key, value in resolved.items() if not value),
        "depends_on_person": depends,
    }
