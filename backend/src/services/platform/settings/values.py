"""Setting values: coerced, redacted, compared with their defaults."""

from __future__ import annotations

from typing import Any

from src.core.clock import iso
from src.core.errors import ValidationError
from src.models.platform import SystemSetting

#: The value a secret comes back as. Never the secret.
REDACTED = "••••••••"


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
