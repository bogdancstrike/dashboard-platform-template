"""Whether a feature is on for a caller."""

from __future__ import annotations

import hashlib
from typing import Any

from src.core.feature_catalogue import FEATURES_BY_KEY
from src.core.features.flag_cache import FlagState, snapshot


def _group_ids(user_id) -> tuple[str, ...]:
    """The ids *and* names of a person's groups, for group targeting."""
    from sqlalchemy import text

    from src.core.db import session_scope

    try:
        with session_scope() as session:
            rows = session.execute(
                text(
                    "SELECT g.id::text, g.name FROM groups g JOIN user_groups ug ON ug.group_id = g.id "
                    "WHERE ug.user_id = :uid"
                ),
                {"uid": str(user_id)},
            ).all()
    except Exception:  # pragma: no cover - a missing table must not break evaluation
        return ()
    return tuple(value for row in rows for value in row)


def evaluate(
    *,
    enabled: bool,
    key: str,
    rollout: int,
    user_ids=(),
    roles=(),
    group_ids=(),
    organization_ids=(),
    user_id=None,
    role_code: str | None = None,
    groups=(),
    organization_id=None,
) -> bool:
    """The whole rollout rule, in one place (the flags screen, `/api/me` and
    the gate all call it).

    Read in this order because that is the order that makes a flag usable:
    off means off for everybody; a named person, role, group or organization
    always has it (that is what naming them is for); then the percentage.

    The percentage is a **stable hash of the flag key and the user id**, not a
    random draw. A flag that flickered on and off between requests would be
    worse than no flag: the feature would half-appear, and every bug report
    about it would be unreproducible.
    """
    if not enabled:
        return False
    if user_id is not None and str(user_id) in set(user_ids or ()):
        return True
    if role_code and role_code in set(roles or ()):
        return True
    if groups and set(group_ids or ()) & {str(group) for group in groups}:
        return True
    if organization_id is not None and str(organization_id) in set(organization_ids or ()):
        return True

    percentage = int(rollout or 0)
    if percentage >= 100:
        return True
    if percentage <= 0:
        # Enabled with no rollout and no targets means "on for the people it
        # names", which is nobody — and a flag that claimed to be on for
        # everybody at nought per cent would make the number meaningless.
        return False
    if user_id is None:
        return False
    digest = hashlib.sha256(f"{key}:{user_id}".encode()).hexdigest()
    return int(digest[:8], 16) % 100 < percentage


def state_on(
    state: FlagState | None,
    *,
    user_id=None,
    role_code: str | None = None,
    groups: tuple[str, ...] = (),
    organization_id=None,
) -> bool:
    """The rollout rule for one flag and one reader — see `services.settings.is_on`."""
    if state is None:
        # A key the platform has no row for gates nothing.
        return True
    return evaluate(
        enabled=state.enabled,
        key=state.key,
        rollout=state.rollout_percentage,
        user_ids=state.target_user_ids,
        roles=state.target_roles,
        group_ids=state.target_group_ids,
        organization_ids=state.target_organization_ids,
        user_id=user_id,
        role_code=role_code,
        groups=groups,
        organization_id=organization_id,
    )


def _principal_context(principal) -> dict[str, Any]:
    if principal is None:
        return {}
    groups = tuple(getattr(principal, "groups", ()) or ())
    return {
        "user_id": principal.user_id,
        "role_code": principal.role_code,
        "groups": groups,
        "organization_id": principal.organization_id,
    }


def enabled_map(principal, states: dict[str, FlagState] | None = None) -> dict[str, bool]:
    """Every flag the platform has, and whether it is on for `principal`.

    Parents count: a child whose parent is off is off. Group targets are only
    looked up when some flag targets a group, which is rare.
    """
    states = snapshot() if states is None else states
    context = _principal_context(principal)
    if principal is not None and any(state.target_group_ids for state in states.values()):
        context["groups"] = tuple(context.get("groups", ())) + _group_ids(principal.user_id)
    own = {
        key: (state.enabled if principal is None else state_on(state, **context))
        for key, state in states.items()
    }

    def resolved(key: str, seen: frozenset[str] = frozenset()) -> bool:
        if not own.get(key, True):
            return False
        feature = FEATURES_BY_KEY.get(key)
        if feature is None:
            return own.get(key, True)
        return all(resolved(parent, seen | {key}) for parent in feature.requires if parent not in seen)

    return {key: resolved(key) for key in sorted(own)}


def is_enabled(key: str, principal=None) -> bool:
    """Whether one feature is on for `principal` (or globally, with None)."""
    states = snapshot()
    if key not in states and key not in FEATURES_BY_KEY:
        return True
    return enabled_map(principal, states).get(key, True)


def globally_enabled(key: str) -> bool:
    """For background work and anonymous callers: is the switch on at all?"""
    return is_enabled(key, None)
