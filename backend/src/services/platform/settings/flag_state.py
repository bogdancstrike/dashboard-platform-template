"""Whether a flag is on for a caller."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from src.core.clock import iso
from src.core.errors import ValidationError
from src.core.features import evaluate
from src.models.platform import FeatureFlag


def enabled_for(session, principal) -> dict[str, bool]:
    """Every flag the platform *has*, and whether it is on for this reader.

    Published with the profile, beside the permission list, because the two
    answer the same shape of question — *what may this person see* — and a
    client that had to ask a second endpoint would render the page once
    without the answer and again with it.

    **A map rather than a list of the enabled ones, and the difference is a
    bug this had.** A client holding only "what is on" cannot tell a flag that
    is off from one that does not exist, so an unknown key reads as off — and a
    page gated on a flag nobody has created yet disappears. A feature that has
    no flag is not a feature somebody switched off; it is one nothing is gating.
    The client can only draw that distinction if it is told both.

    Computed with `is_on`, the same function the flags screen reports
    `on_for_me` with. A flag is a rollout rule, and a second implementation of
    it in the browser is how "it says it is on and I do not have it" becomes
    unanswerable.
    """
    from src.core import features

    del session  # read through the shared, cached snapshot instead
    return features.enabled_map(principal)


def is_on(
    row: FeatureFlag,
    *,
    user_id: UUID | None,
    role_code: str | None,
    groups: tuple[str, ...] | list[str] = (),
    organization_id: UUID | str | None = None,
) -> bool:
    """Whether one flag *row* is on for one person — see `evaluate`."""
    return evaluate(
        enabled=bool(row.enabled),
        key=row.key,
        rollout=int(row.rollout_percentage or 0),
        user_ids=row.target_user_ids or (),
        roles=row.target_roles or (),
        group_ids=getattr(row, "target_group_ids", None) or (),
        organization_ids=getattr(row, "target_organization_ids", None) or (),
        user_id=user_id,
        role_code=role_code,
        groups=groups,
        organization_id=organization_id,
    )


def _flag(row: FeatureFlag, principal, *, on_for_me: bool | None = None) -> dict[str, Any]:
    from src.core.feature_catalogue import FEATURES_BY_KEY

    user_id = getattr(principal, "user_id", None)
    role_code = getattr(principal, "role_code", None)
    feature = FEATURES_BY_KEY.get(row.key)
    if on_for_me is None:
        on_for_me = is_on(
            row,
            user_id=user_id,
            role_code=role_code,
            groups=tuple(getattr(principal, "groups", ()) or ()),
            organization_id=getattr(principal, "organization_id", None),
        )
    return {
        "key": row.key,
        "name": row.name,
        "description": row.description,
        "enabled": bool(row.enabled),
        "environment": row.environment,
        "stage": row.stage,
        "rollout_percentage": int(row.rollout_percentage or 0),
        "target_roles": list(row.target_roles or []),
        "target_user_ids": list(row.target_user_ids or []),
        "target_group_ids": list(row.target_group_ids or []),
        "target_organization_ids": list(row.target_organization_ids or []),
        "experimental": bool(row.experimental),
        "last_toggled_at": iso(row.last_toggled_at),
        "updated_at": iso(row.updated_at),
        # The answer to "it is enabled but I do not have it" — computed by the
        # same function the API would use to gate anything.
        "on_for_me": on_for_me,
        # And whether that is *because* of the percentage, so the number on
        # screen explains the answer beside it rather than contradicting it.
        "partial": bool(row.enabled and 0 < int(row.rollout_percentage or 0) < 100),
        # What the catalogue says about it: where it lives, what it needs and
        # what it controls. A flag the catalogue does not know is an
        # installation's own, and controls only what reads it.
        "area": feature.area if feature else "custom",
        "requires": list(feature.requires) if feature else [],
        "default_on": feature.default_on if feature else False,
        "in_catalogue": feature is not None,
        "controls": _controls(row.key),
    }


def _controls(key: str) -> dict[str, Any]:
    from src.core import features
    from src.core.feature_catalogue import FEATURES, FEATURES_BY_KEY

    feature = FEATURES_BY_KEY.get(key)
    if feature is None:
        return {"routes": [], "nav": [], "components": [], "endpoints": [], "jobs": [], "live": [],
                "payload_rules": [], "dependents": []}
    return {
        "routes": list(feature.routes),
        "nav": list(feature.nav),
        "components": list(feature.components),
        "endpoints": features.endpoints_of(key),
        "jobs": list(feature.jobs),
        "live": list(feature.live),
        "payload_rules": list(feature.payload_rules),
        # Turning a parent off takes these with it.
        "dependents": [other.key for other in FEATURES if key in other.requires],
    }


def _flag_state(row: FeatureFlag) -> dict[str, Any]:
    return {
        "enabled": bool(row.enabled),
        "rollout_percentage": int(row.rollout_percentage or 0),
        "target_roles": list(row.target_roles or []),
        "target_user_ids": list(row.target_user_ids or []),
        "target_group_ids": list(row.target_group_ids or []),
        "target_organization_ids": list(row.target_organization_ids or []),
        "stage": row.stage,
    }


def _strings(raw: Any, field: str) -> list[str] | None:
    if raw in (None, [], ""):
        return None
    if not isinstance(raw, list):
        raise ValidationError(f"{field} must be a list")
    return sorted({str(item).strip()[:64] for item in raw if str(item).strip()}) or None


def _codes(raw: Any, field: str) -> list[str] | None:
    if raw in (None, [], ""):
        return None
    if not isinstance(raw, list):
        raise ValidationError(f"{field} must be a list")
    return sorted({str(item).strip().upper()[:48] for item in raw if str(item).strip()}) or None
