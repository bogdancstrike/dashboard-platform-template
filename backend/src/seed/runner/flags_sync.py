"""Repairing feature flags and preferences."""

from __future__ import annotations

from copy import deepcopy

from sqlalchemy import select


def sync_flags(session, *, reset: bool = False) -> dict[str, int]:
    """Bring the flag rows in line with the feature catalogue (§27).

    The catalogue (`core/feature_catalogue.py`) is the single source of truth
    for which flags exist. Additive and respectful of decisions, so it is safe
    on a live database:

    * a catalogue flag with no row is **created** at its default (on, 100 %);
    * every catalogue row gets the catalogue's name, description and stage —
      the labels are the catalogue's, the *state* is the administrator's;
    * a row whose state nobody has ever changed by hand (no `FLAG_CHANGE` in
      the audit trail) and that disagrees with its default is **reset** to it —
      that is the old seed's dice roll (`impersonation` at 75 % and off), not a
      decision;
    * a flag somebody *has* toggled is left exactly as it is;
    * retired flags (`RETIRED`), which gate nothing any more, are removed.

    `reset=True` (`--reset-flags`) puts *every* catalogue flag back at its
    seeded default, decisions included — what a test run or a crawl that
    toggled switches on the live stack is undone with.
    """
    from src.core import features as feature_gate
    from src.core.feature_catalogue import FEATURES, RETIRED
    from src.models.platform import AuditLog, FeatureFlag

    rows = {row.key: row for row in session.scalars(select(FeatureFlag)).all()}
    touched = {
        str(value)
        for value in session.scalars(
            select(AuditLog.resource_id).where(
                AuditLog.resource_type == "feature_flag", AuditLog.action == "FLAG_CHANGE"
            )
        ).all()
    }
    created = relabelled = restored = removed = 0
    for feature in FEATURES:
        row = rows.get(feature.key)
        if row is None:
            session.add(
                FeatureFlag(
                    key=feature.key,
                    name=feature.name,
                    description=feature.description,
                    enabled=feature.default_on,
                    environment="production",
                    stage=feature.stage,
                    rollout_percentage=feature.default_rollout,
                    experimental=feature.experimental,
                )
            )
            created += 1
            continue
        if (row.name, row.description, row.stage, bool(row.experimental)) != (
            feature.name, feature.description, feature.stage, feature.experimental
        ):
            row.name, row.description = feature.name, feature.description
            row.stage, row.experimental = feature.stage, feature.experimental
            relabelled += 1
        at_default = (
            bool(row.enabled) == feature.default_on
            and int(row.rollout_percentage or 0) == feature.default_rollout
            and not row.target_user_ids and not row.target_roles
        )
        if not at_default and (reset or str(row.id) not in touched):
            row.enabled = feature.default_on
            row.rollout_percentage = feature.default_rollout
            row.target_user_ids = None
            row.target_roles = None
            row.target_group_ids = None
            row.target_organization_ids = None
            restored += 1
    for key in RETIRED:
        row = rows.get(key)
        if row is not None:
            session.delete(row)
            removed += 1
    session.flush()
    feature_gate.invalidate()
    return {
        "created": created,
        "relabelled": relabelled,
        "reset": restored,
        "removed": removed,
        "checked": len(FEATURES),
        # Kept for the CLI message and older callers.
        "repaired": created + restored,
    }


def sync_preferences(session) -> dict[str, int]:
    """Fill in preference keys an account's stored blob predates (§40).

    The ninth repair, and a sibling of `sync_settings`: the declaration in
    `services/me.py` gains a key — a pop-up placement, a mail preview side —
    and every account seeded before it has a blob without that key. Reading
    falls back to the default, so nothing breaks; *writing* one section of a
    blob that has never held the key is where a half-populated preference comes
    from, and the preferences screen then renders a control with no value.

    Additive only, and that is what makes it safe on a live database: a key
    already present keeps whatever value somebody chose, whether or not it
    matches the default. The single exception is `sidebar_collapsed`, seeded
    `True` for a quarter of the demo personas — signing in to a rail of
    unlabelled icons reads as broken navigation rather than as a preference,
    so it is reset the way `sync_flags` resets a rollout on a shipped feature.

    Idempotent, so it can run on every deploy.
    """
    from src.models.identity import User
    from src.services.people.account import PREFERENCE_DEFAULTS

    filled = reset = 0
    for row in session.scalars(select(User)).all():
        stored = dict(row.preferences or {})
        changed = False
        for section, defaults in PREFERENCE_DEFAULTS.items():
            block = dict(stored.get(section) or {})
            for key, default in defaults.items():
                if key not in block:
                    block[key] = deepcopy(default)
                    changed = True
            if block != (stored.get(section) or {}):
                stored[section] = block
        if stored.get("appearance", {}).get("sidebar_collapsed"):
            stored["appearance"]["sidebar_collapsed"] = False
            reset += 1
            changed = True
        if changed:
            # Reassigned rather than mutated: the column is JSON, and SQLAlchemy
            # does not see an in-place edit of a dict it handed out.
            row.preferences = stored
            filled += 1
    return {"filled": filled, "expanded": reset}
