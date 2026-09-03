"""The current user's platform profile and personal preferences (§40, §58).

Keycloak proves identity, while this service returns the application-side
profile: organization membership, the live role definition and preferences.
Keeping this query behind one endpoint gives the SPA one authoritative answer
for both its identity chrome and every permission-aware navigation decision.
"""

from __future__ import annotations

from copy import deepcopy
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import joinedload

from src.core.clock import iso
from src.core.errors import NotFoundError, ValidationError

PREFERENCE_DEFAULTS: dict[str, dict[str, Any]] = {
    "appearance": {
        "theme": "system",
        "density": "middle",
        "sidebar_collapsed": False,
    },
    "formats": {
        "date": "YYYY-MM-DD",
        "time": "24h",
        "number": "1,234.56",
    },
    "defaults": {
        "page_size": 25,
        "landing_page": "dashboard",
    },
}

_CHOICES: dict[tuple[str, str], set[Any]] = {
    ("appearance", "theme"): {"light", "dark", "system"},
    ("appearance", "density"): {"compact", "middle", "comfortable"},
    ("formats", "date"): {"YYYY-MM-DD", "DD/MM/YYYY", "MM/DD/YYYY"},
    ("formats", "time"): {"24h", "12h"},
    ("formats", "number"): {"1 234,56", "1,234.56"},
    ("defaults", "page_size"): {10, 25, 50, 100},
    ("defaults", "landing_page"): {
        "dashboard",
        "analytics",
        "tasks",
        "inbox",
        "projects",
        "explore",
    },
}


def get_profile(session, principal) -> dict[str, Any]:
    """Return one consistent snapshot of the caller's local profile."""
    from src.models.identity import Role, Team, User

    user = session.scalars(
        select(User)
        .options(
            joinedload(User.organization),
            joinedload(User.department),
            joinedload(User.role),
        )
        .where(User.id == principal.user_id, User.deleted_at.is_(None))
    ).first()
    if user is None:
        raise NotFoundError("The signed-in user's platform profile no longer exists.")

    # The token names the role membership; the database row supplies its live
    # label, colour and permissions. The user's stored role may lag one request
    # behind an identity-provider change, so resolve by principal.role_code.
    role = session.scalars(select(Role).where(Role.code == principal.role_code)).first()
    team = session.get(Team, user.team_id) if user.team_id else None

    return {
        "user": {
            "id": str(user.id),
            "email": user.email,
            "username": user.username,
            "full_name": user.full_name,
            "first_name": user.first_name,
            "last_name": user.last_name,
            "avatar_url": user.avatar_url,
            "initials": user.initials,
            "phone": user.phone,
            "job_title": user.job_title,
            "status": user.status,
            "locale": user.locale,
            "timezone": user.timezone,
            "joined_at": iso(user.created_at),
            "last_seen_at": iso(user.last_login_at),
            "profile_completeness": user.profile_completeness,
            "mfa_enabled": bool(user.mfa_enabled),
        },
        "role": {
            "code": principal.role_code,
            "name": role.name if role else principal.role_code.replace("_", " ").title(),
            "description": role.description if role else None,
            "color": role.color if role else "#64748b",
        },
        "organization": _named(user.organization, "slug"),
        "department": _named(user.department, "code"),
        "team": _named(team, "slug"),
        "groups": list(principal.groups),
        "permissions": sorted(principal.permissions),
        "preferences": merged_preferences(user.preferences),
        "session": {
            "id": principal.session_id,
            "impersonating": principal.is_impersonating,
            "impersonator_id": (
                str(principal.impersonator_id) if principal.impersonator_id else None
            ),
            "impersonator_label": principal.impersonator_label or None,
        },
    }


def update_preferences(
    session, user_id: UUID, patch: dict[str, Any]
) -> dict[str, dict[str, Any]]:
    """Validate and merge a partial preference document."""
    from src.models.identity import User

    user = session.get(User, user_id)
    if user is None or user.deleted_at is not None:
        raise NotFoundError("The signed-in user's platform profile no longer exists.")

    validated = _validate_patch(patch)
    preferences = merged_preferences(user.preferences)
    for section, values in validated.items():
        preferences[section].update(values)
    user.preferences = preferences
    session.flush()
    return preferences


def merged_preferences(stored: dict[str, Any] | None) -> dict[str, dict[str, Any]]:
    result = deepcopy(PREFERENCE_DEFAULTS)
    if not isinstance(stored, dict):
        return result
    for section, defaults in result.items():
        values = stored.get(section)
        if isinstance(values, dict):
            defaults.update({key: value for key, value in values.items() if key in defaults})
    return result


def _validate_patch(patch: dict[str, Any]) -> dict[str, dict[str, Any]]:
    if not isinstance(patch, dict):
        raise ValidationError(
            "preferences must be an object.", details={"field": "preferences"}
        )
    if not patch:
        raise ValidationError(
            "At least one preference is required.", details={"field": "preferences"}
        )

    validated: dict[str, dict[str, Any]] = {}
    for section, values in patch.items():
        if section not in PREFERENCE_DEFAULTS:
            _invalid(f"preferences.{section}", "Unknown preference section.")
        if not isinstance(values, dict):
            _invalid(f"preferences.{section}", "Preference section must be an object.")
        validated[section] = {}
        for key, value in values.items():
            field = f"preferences.{section}.{key}"
            if key not in PREFERENCE_DEFAULTS[section]:
                _invalid(field, "Unknown preference.")
            if (section, key) == ("appearance", "sidebar_collapsed"):
                if not isinstance(value, bool):
                    _invalid(field, "Must be true or false.")
            elif value not in _CHOICES[(section, key)]:
                _invalid(field, f"Must be one of: {_choice_text(_CHOICES[(section, key)])}.")
            validated[section][key] = value
    return validated


def _named(value, extra: str) -> dict[str, str] | None:
    if value is None:
        return None
    return {"id": str(value.id), "name": value.name, extra: str(getattr(value, extra))}


def _choice_text(values: set[Any]) -> str:
    return ", ".join(str(value) for value in sorted(values, key=str))


def _invalid(field: str, message: str) -> None:
    raise ValidationError(message, details={"field": field})
