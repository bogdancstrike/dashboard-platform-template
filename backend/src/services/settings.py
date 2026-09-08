"""System settings and feature flags (§11, §27).

Two tables, one module, because they are the same *kind* of thing: runtime
configuration an administrator changes without a deploy. Four decisions.

**A setting is one row per key, and it declares its own type.** `value_type`
and `options` are what the form is rendered from, so a boolean gets a switch
and a choice gets a select — and adding a setting needs no frontend change at
all. A single JSON document of configuration would render as a textarea and
audit as "the settings changed".

**The default is carried beside the value, so drift is visible.** Knowing what
a setting *was* shipped as is the difference between "somebody chose this" and
"this is how it comes" — and it makes Reset a button rather than a migration.

**A secret is never sent.** `is_secret` rows come back with the value replaced
by whether one is set. A settings screen that renders an API key is a settings
screen that puts it in a screenshot, a browser cache and a support ticket.

**A flag says who it is on for, and the answer is computed here.** Percentage,
roles, groups and named people all narrow the same flag, so "is it on for me"
has one implementation — in the service, next to the rollout it reads. Two
implementations of that arithmetic is a flag that is on in the UI and off in
the API.
"""

from __future__ import annotations

import hashlib
from typing import Any
from uuid import UUID

from sqlalchemy import func, select

from src.core import audit
from src.core.clock import iso, now
from src.core.errors import ConflictError, NotFoundError, ValidationError
from src.core.pagination import parse_uuid
from src.models.platform import FeatureFlag, SystemSetting

#: Reading the configuration and changing it are the same privilege: a setting
#: names an SMTP host and a retention period, and a reader who may see those
#: is a reader who is already trusted with them.
SETTINGS_PERMISSION = "settings.manage"
#: Flags are their own privilege because turning one on ships a feature.
FLAGS_PERMISSION = "flags.manage"

#: What a value may be. Declared per row and read by the form, so a new
#: setting needs no frontend change — and a type the form cannot render is
#: refused here rather than drawn as a textarea.
VALUE_TYPES = ("string", "integer", "boolean", "choice", "json", "duration")

#: The value a secret comes back as. Never the secret.
REDACTED = "••••••••"

MAX_KEY = 96
MAX_LABEL = 200


# ── Settings ─────────────────────────────────────────────────────────────


def settings(session, args, *, principal) -> dict[str, Any]:
    """Every setting, grouped by category, with what it was shipped as.

    Grouped on the server rather than in the browser because the *order* of
    the categories is a decision — general before security before retention —
    and a page that sorted them alphabetically would put "advanced" first.
    """
    principal.require(SETTINGS_PERMISSION)
    statement = select(SystemSetting).order_by(
        SystemSetting.category.asc(), SystemSetting.label.asc()
    )

    category = str((args or {}).get("category") or "").strip()
    if category:
        statement = statement.where(SystemSetting.category == category)

    term = str((args or {}).get("q") or "").strip().lower()
    rows = session.scalars(statement).all()
    if term:
        rows = [
            row
            for row in rows
            if term in row.label.lower()
            or term in row.key.lower()
            or term in (row.description or "").lower()
        ]

    groups: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        groups.setdefault(row.category, []).append(_setting(row))

    return {
        "groups": [
            {"key": key, "label": key.replace("_", " ").title(), "items": items}
            for key, items in groups.items()
        ],
        "total": len(rows),
        "categories": _categories(session),
        "value_types": list(VALUE_TYPES),
        # How many differ from what the platform ships with — the number an
        # administrator wants before a deploy, and the reason the default is
        # stored beside the value at all.
        "changed": sum(1 for row in rows if _drifted(row)),
        "restart_pending": sum(
            1 for row in rows if row.requires_restart and _drifted(row)
        ),
    }


def _categories(session) -> list[dict[str, Any]]:
    rows = session.execute(
        select(SystemSetting.category, func.count()).group_by(SystemSetting.category)
    ).all()
    return [
        {"key": row[0], "label": str(row[0]).replace("_", " ").title(), "count": int(row[1])}
        for row in sorted(rows, key=lambda item: item[0])
    ]


def update_setting(session, key: Any, payload: dict[str, Any], *, principal):
    """Change one setting.

    One key per request on purpose: the audit row then names exactly what
    changed, and a refusal names the setting it refused. A bulk write of a
    configuration document audits as "the settings changed", which is the least
    useful thing an audit trail can say.
    """
    principal.require(SETTINGS_PERMISSION)
    row = session.scalar(select(SystemSetting).where(SystemSetting.key == str(key or "")))
    if row is None:
        raise NotFoundError("That setting does not exist.", details={"key": str(key or "")})

    data = payload if isinstance(payload, dict) else {}
    if "value" not in data and not data.get("reset"):
        raise ValidationError("Send a value, or ask for a reset.")

    before = {"value": _visible(row), "updated_at": iso(row.updated_at)}
    if data.get("reset"):
        row.value = row.default_value
    else:
        row.value = {"value": _coerced(row, data["value"])}
    row.updated_by_id = getattr(principal, "user_id", None)
    session.flush()

    audit.record(
        session,
        action="SETTING_CHANGE",
        resource_type="system_setting",
        resource_id=row.id,
        resource_label=row.label,
        principal=principal,
        before=before,
        after={"value": _visible(row), "updated_at": iso(row.updated_at)},
        message=(
            f"reset {row.label} to its default"
            if data.get("reset")
            else f"changed {row.label}"
        ),
    )
    return _setting(row)


def _coerced(row: SystemSetting, raw: Any) -> Any:
    """One value, in the type the row declares.

    Coerced rather than trusted: a browser sends `"25"` for a number and
    `"false"` for a boolean, and a setting stored as the string `"false"` is a
    setting that reads as *true* everywhere it is used — the quietest possible
    configuration bug.
    """
    kind = row.value_type
    if kind == "boolean":
        if isinstance(raw, bool):
            return raw
        text = str(raw).strip().lower()
        if text in ("true", "1", "yes", "on"):
            return True
        if text in ("false", "0", "no", "off"):
            return False
        raise ValidationError(f"{row.label} is a yes-or-no setting.", details={"value": raw})

    if kind in ("integer", "duration"):
        try:
            number = int(str(raw).strip())
        except (TypeError, ValueError) as error:
            raise ValidationError(
                f"{row.label} is a whole number.", details={"value": raw}
            ) from error
        options = row.options if isinstance(row.options, dict) else {}
        low, high = options.get("minimum"), options.get("maximum")
        if low is not None and number < int(low):
            raise ValidationError(f"{row.label} is at least {low}.", details={"minimum": low})
        if high is not None and number > int(high):
            raise ValidationError(f"{row.label} is at most {high}.", details={"maximum": high})
        return number

    if kind == "choice":
        options = row.options if isinstance(row.options, dict) else {}
        allowed = [str(item) for item in (options.get("choices") or [])]
        text = str(raw)
        if allowed and text not in allowed:
            raise ValidationError(
                f"{row.label} must be one of the choices it declares.",
                details={"value": text, "allowed": allowed},
            )
        return text

    if kind == "json":
        if not isinstance(raw, (dict, list)):
            raise ValidationError(f"{row.label} is a JSON object or list.")
        return raw

    text = str(raw)
    if len(text) > 4000:
        raise ValidationError(f"{row.label} is at most 4000 characters.")
    return text


def _visible(row: SystemSetting) -> Any:
    """The value as a screen may see it — never a secret."""
    if row.is_secret:
        return REDACTED if _raw(row.value) not in (None, "") else None
    return _raw(row.value)


def _raw(document: Any) -> Any:
    """The value out of its `{"value": …}` wrapper.

    Wrapped in the column because JSONB cannot hold a bare scalar in every
    driver; unwrapped here so no caller has to know that.
    """
    if isinstance(document, dict) and "value" in document:
        return document["value"]
    return document


def _drifted(row: SystemSetting) -> bool:
    return _raw(row.value) != _raw(row.default_value)


def _setting(row: SystemSetting) -> dict[str, Any]:
    return {
        "key": row.key,
        "category": row.category,
        "label": row.label,
        "description": row.description,
        "value": _visible(row),
        # The default, so drift is visible and Reset is a button rather than a
        # migration. Redacted too: a shipped secret is still a secret.
        "default": REDACTED if row.is_secret and row.default_value else _raw(row.default_value),
        "value_type": row.value_type,
        "options": row.options or {},
        "is_secret": bool(row.is_secret),
        "requires_restart": bool(row.requires_restart),
        "changed": _drifted(row),
        "updated_at": iso(row.updated_at),
    }


# ── Feature flags ────────────────────────────────────────────────────────


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

    rows = session.scalars(statement).all()
    return {
        "items": [_flag(row, principal) for row in rows],
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


def update_flag(session, key: Any, payload: dict[str, Any], *, principal):
    """Turn a flag on or off, or change who it is on for."""
    principal.require(FLAGS_PERMISSION)
    row = session.scalar(select(FeatureFlag).where(FeatureFlag.key == str(key or "")))
    if row is None:
        raise NotFoundError("That flag does not exist.", details={"key": str(key or "")})

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
    row = session.scalar(select(FeatureFlag).where(FeatureFlag.key == str(key or "")))
    if row is None:
        raise NotFoundError("That flag does not exist.", details={"key": str(key or "")})
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


def is_on(row: FeatureFlag, *, user_id: UUID | None, role_code: str | None) -> bool:
    """Whether one flag is on for one person.

    The whole rollout rule, in one place. Read in this order because that is
    the order that makes a flag usable: off means off for everybody; a named
    person always has it (that is what naming them is for); then a role; then
    the percentage.

    The percentage is a **stable hash of the flag key and the user id**, not a
    random draw. A flag that flickered on and off between requests would be
    worse than no flag: the feature would half-appear, and every bug report
    about it would be unreproducible.
    """
    if not row.enabled:
        return False
    if user_id is not None and str(user_id) in (row.target_user_ids or []):
        return True
    if role_code and role_code in (row.target_roles or []):
        return True

    percentage = int(row.rollout_percentage or 0)
    if percentage >= 100:
        return True
    if percentage <= 0:
        # Enabled with no rollout and no targets means "on for the people it
        # names", which is nobody — and a flag that claimed to be on for
        # everybody at nought per cent would make the number meaningless.
        return False
    if user_id is None:
        return False
    digest = hashlib.sha256(f"{row.key}:{user_id}".encode()).hexdigest()
    return int(digest[:8], 16) % 100 < percentage


def _flag(row: FeatureFlag, principal) -> dict[str, Any]:
    user_id = getattr(principal, "user_id", None)
    role_code = getattr(principal, "role_code", None)
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
        "experimental": bool(row.experimental),
        "last_toggled_at": iso(row.last_toggled_at),
        "updated_at": iso(row.updated_at),
        # The answer to "it is enabled but I do not have it" — computed by the
        # same function the API would use to gate anything.
        "on_for_me": is_on(row, user_id=user_id, role_code=role_code),
        # And whether that is *because* of the percentage, so the number on
        # screen explains the answer beside it rather than contradicting it.
        "partial": bool(row.enabled and 0 < int(row.rollout_percentage or 0) < 100),
    }


def _flag_state(row: FeatureFlag) -> dict[str, Any]:
    return {
        "enabled": bool(row.enabled),
        "rollout_percentage": int(row.rollout_percentage or 0),
        "target_roles": list(row.target_roles or []),
        "target_user_ids": list(row.target_user_ids or []),
        "stage": row.stage,
    }


def _codes(raw: Any, field: str) -> list[str] | None:
    if raw in (None, [], ""):
        return None
    if not isinstance(raw, list):
        raise ValidationError(f"{field} must be a list")
    return sorted({str(item).strip().upper()[:48] for item in raw if str(item).strip()}) or None
