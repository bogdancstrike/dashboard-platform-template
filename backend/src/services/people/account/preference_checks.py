"""Merging and validating preference patches."""

from __future__ import annotations

from copy import deepcopy
from typing import Any

from src.core.errors import ValidationError
from src.services.people.account.preference_vocabulary import (
    _CHOICES,
    _FLAGS,
    _SETS,
    _TEXT,
    PREFERENCE_DEFAULTS,
)


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
            if (section, key) in _FLAGS:
                if not isinstance(value, bool):
                    _invalid(field, "Must be true or false.")
            elif (section, key) in _TEXT:
                if not isinstance(value, str):
                    _invalid(field, "Must be text.")
                value = value.strip()[: _TEXT[(section, key)]]
            elif (section, key) in _SETS:
                allowed = _SETS[(section, key)]
                if not isinstance(value, list):
                    _invalid(field, "Must be a list.")
                unknown = [item for item in value if item not in allowed]
                if unknown:
                    _invalid(field, f"Must be one of: {_choice_text(allowed)}.")
                # De-duplicated and ordered, so two clients sending the same
                # answer in a different order store the same document.
                value = sorted({str(item) for item in value})
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
