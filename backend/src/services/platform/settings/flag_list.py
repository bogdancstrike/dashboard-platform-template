"""Feature flags: the list, and turning one on or off."""

from __future__ import annotations

from typing import Any

from sqlalchemy import select

from src.core import audit
from src.core.clock import now
from src.core.errors import ValidationError
from src.core.pagination import parse_uuid
from src.core.repository import found_or_404
from src.models.platform import FeatureFlag
from src.services.platform.settings.flag_state import (
    _codes,
    _flag,
    _flag_state,
    _strings,
)
from src.services.platform.settings.system_settings import FLAGS_PERMISSION


def flags(session, args, *, principal) -> dict[str, Any]:
    """Every flag, and — for each — whether it is on for *this* reader.

    That last part is the point: a list of flags with a global on/off says
    nothing about what the person reading it will actually see, and "it is
    enabled but I do not have it" is the commonest question a flag screen gets.
    """
    principal.require(FLAGS_PERMISSION)
    statement = select(FeatureFlag).order_by(
        FeatureFlag.enabled.desc(), FeatureFlag.name.asc()
    )

    stage = str((args or {}).get("stage") or "").strip().upper()
    if stage:
        statement = statement.where(FeatureFlag.stage == stage)
    state = str((args or {}).get("state") or "").strip().upper()
    if state == "ON":
        statement = statement.where(FeatureFlag.enabled.is_(True))
    elif state == "OFF":
        statement = statement.where(FeatureFlag.enabled.is_(False))

    area = str((args or {}).get("area") or "").strip().lower()
    term = str((args or {}).get("q") or "").strip().lower()

    from src.core import features
    from src.core.feature_catalogue import AREAS, FEATURES_BY_KEY

    resolved = features.enabled_map(principal)
    rows = session.scalars(statement).all()
    if area:
        rows = [
            row for row in rows
            if (FEATURES_BY_KEY[row.key].area if row.key in FEATURES_BY_KEY else "custom") == area
        ]
    if term:
        rows = [
            row for row in rows
            if term in row.key.lower() or term in row.name.lower() or term in (row.description or "").lower()
        ]
    return {
        "items": [_flag(row, principal, on_for_me=resolved.get(row.key)) for row in rows],
        "areas": [{"key": key, "label": label} for key, label in AREAS] + [{"key": "custom", "label": "Custom"}],
        "total": len(rows),
        "counts": {
            "total": len(rows),
            "on": sum(1 for row in rows if row.enabled),
            "partial": sum(
                1 for row in rows if row.enabled and 0 < int(row.rollout_percentage or 0) < 100
            ),
            "experimental": sum(1 for row in rows if row.experimental),
        },
        "stages": sorted({row.stage for row in rows}),
    }


def _flag_row(session, key: Any) -> FeatureFlag:
    return found_or_404(
        session.scalar(select(FeatureFlag).where(FeatureFlag.key == str(key or ""))),
        "That flag does not exist.",
        details={"key": str(key or "")},
    )


def update_flag(session, key: Any, payload: dict[str, Any], *, principal):
    """Turn a flag on or off, or change who it is on for."""
    principal.require(FLAGS_PERMISSION)
    row = _flag_row(session, key)

    data = payload if isinstance(payload, dict) else {}
    before = _flag_state(row)

    if "enabled" in data:
        enabled = bool(data["enabled"])
        if enabled != row.enabled:
            row.enabled = enabled
            # Stamped only when the switch actually moves, so "last toggled"
            # answers "when did this change" rather than "when was this row
            # last written".
            row.last_toggled_at = now()
    if "rollout_percentage" in data:
        try:
            percentage = int(data["rollout_percentage"])
        except (TypeError, ValueError) as error:
            raise ValidationError("A rollout is a whole percentage.") from error
        if not 0 <= percentage <= 100:
            raise ValidationError("A rollout runs from 0 to 100 per cent.")
        row.rollout_percentage = percentage
    if "target_roles" in data:
        row.target_roles = _codes(data["target_roles"], "target_roles")
    if "target_user_ids" in data:
        row.target_user_ids = [
            str(parse_uuid(item, field="target_user_ids"))
            for item in (data["target_user_ids"] or [])
        ] or None
    if "target_group_ids" in data:
        row.target_group_ids = _strings(data["target_group_ids"], "target_group_ids")
    if "target_organization_ids" in data:
        row.target_organization_ids = [
            str(parse_uuid(item, field="target_organization_ids"))
            for item in (data["target_organization_ids"] or [])
        ] or None
    if "description" in data:
        row.description = str(data["description"] or "").strip()[:2000] or None
    if "stage" in data:
        row.stage = str(data["stage"] or "BETA").strip().upper()[:24]
    if "experimental" in data:
        row.experimental = bool(data["experimental"])

    row.updated_by_id = getattr(principal, "user_id", None)
    session.flush()
    audit.record(
        session,
        action="FLAG_CHANGE",
        resource_type="feature_flag",
        resource_id=row.id,
        resource_label=row.name,
        principal=principal,
        before=before,
        after=_flag_state(row),
        message=f"{'enabled' if row.enabled else 'disabled'} {row.name}",
    )
    return _flag(row, principal)
