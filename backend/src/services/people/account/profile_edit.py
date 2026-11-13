"""The reader's own profile and preferences: read and change."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import joinedload

from src.core.clock import iso
from src.core.errors import NotFoundError, ValidationError
from src.core.repository import found_or_404, get_or_404
from src.services.people.account.preference_checks import (
    _invalid,
    _named,
    _validate_patch,
    merged_preferences,
)
from src.services.platform import settings


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
        # Every feature the platform has, and whether it is on for this reader
        # — beside which permissions they hold, because the two answer the same
        # shape of question and a client that had to ask a second endpoint
        # would draw the page once without the answer and again with it (§27).
        #
        # A *map*, not a list of the enabled ones: a client holding only "what
        # is on" cannot tell a flag that is off from one that was never
        # created, so a page gated on a flag nobody has made yet vanishes.
        "features": settings.enabled_for(session, principal),
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

    user = get_or_404(
        session, User, user_id, "The signed-in user's platform profile no longer exists.", live=True
    )

    validated = _validate_patch(patch)
    preferences = merged_preferences(user.preferences)
    for section, values in validated.items():
        preferences[section].update(values)
    user.preferences = preferences
    session.flush()
    return preferences


#: What a person may change about *themselves*, and how far each may go.
#:
#: Deliberately short, and deliberately not the whole row. Three kinds of field
#: are absent on purpose:
#:
#: * **identity** — `email` and `username` prove who you are to Keycloak, and a
#:   platform that let its own copy drift from the realm's would authenticate
#:   somebody as one person and show them another's records;
#: * **placement** — role, organization, department, team. Those are decisions
#:   somebody else makes about you, and a page where you may promote yourself
#:   is not an access model;
#: * **state** — `status`, `mfa_enabled`, `last_login_at`. Recorded by the
#:   platform, not typed by anybody.
#:
#: What is left is exactly the set a person is the authority on: what they are
#: called, how to reach them, what they do, and what clock they keep.
EDITABLE_FIELDS: dict[str, int] = {
    "full_name": 160,
    "first_name": 80,
    "last_name": 80,
    "job_title": 120,
    "phone": 48,
    "avatar_url": 500,
    "locale": 12,
    "timezone": 64,
}


def update_profile(session, user_id: UUID, patch: Any) -> dict[str, Any]:
    """Change what a person is the authority on about themselves (§40).

    There was nowhere in this platform somebody could correct their own job
    title or say which timezone they keep — the profile page displayed both and
    the only writer was an administrator on `/admin/users/:id`, which is the
    page the person concerned cannot open.

    Trimmed and truncated rather than refused, for the same reason the
    preferences are: a job title two characters over a limit is not a decision
    worth a round trip. An empty string clears the field, because "I have no
    phone number here" is an answer.
    """
    if not isinstance(patch, dict) or not patch:
        raise ValidationError(
            "At least one detail is required.", details={"field": "user"}
        )

    unknown = set(patch) - set(EDITABLE_FIELDS)
    if unknown:
        _invalid(f"user.{sorted(unknown)[0]}", "This is not yours to change here.")

    user = found_or_404(session.get(_user_model(), user_id), "No profile for the signed-in user.")

    for key, value in patch.items():
        if value is not None and not isinstance(value, str):
            _invalid(f"user.{key}", "Must be text.")
        text = str(value or "").strip()[: EDITABLE_FIELDS[key]]
        # `full_name` is what every list, avatar and mention renders, so it is
        # the one field that may not be blanked: a person with no name is a row
        # nobody can identify.
        if key == "full_name" and not text:
            _invalid("user.full_name", "A name is how everybody else finds you.")
        setattr(user, key, text or (None if key != "full_name" else user.full_name))

    session.flush()
    return {"updated": sorted(patch)}


def _user_model():
    from src.models.identity import User

    return User
