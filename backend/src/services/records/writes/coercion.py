"""A payload coerced onto a dataset's writable fields."""

from __future__ import annotations

from typing import Any

from src.core.errors import ValidationError
from src.core.query import Field
from src.services.records.explorer import Resource, Writable
from src.services.records.writes.events import CONCURRENCY_KEY
from src.services.records.writes.values import (
    _document,
    _moment,
    _number,
    _reference,
    _text,
)


def _object(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise ValidationError("The record must be a JSON object.")
    return payload


def coerce(
    session, resource: Resource, payload: dict[str, Any], *, creating: bool
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """Every writable field the payload names, converted — and every problem.

    The same loop `_coerced` uses, differing only in what it does with a
    failure: this collects them all, that raises the first. Both exist because
    a form and an import want opposite things from the same rules.

    A form wants the first error and wants it now: the person is looking at the
    field, and thirty messages about a payload they sent one field of would be
    noise. An import wants every error on every row *before* anything is
    written — "row 14 has a bad status" followed by "row 14 also has a bad
    date" one execute later is a wizard somebody goes round twice.

    What must not happen is two sets of rules. An importer that validated a CSV
    itself would accept rows a form refuses, and the first anybody would hear
    of it is a 500 during the execute — so this is the one place the coercion
    lives, and `services/imports` calls exactly this.
    """
    writable = resource.writable
    if not writable:
        return {}, [
            {
                "field": "",
                "message": f"{resource.label} are read-only.",
                "details": {"resource_type": resource.key},
            }
        ]

    problems: list[dict[str, Any]] = []
    unknown = sorted(set(payload) - set(writable) - {CONCURRENCY_KEY})
    if unknown:
        # Not a per-field problem: a payload naming a field that does not exist
        # is a caller that has the wrong idea about the resource, and answering
        # per field would bury that.
        return {}, [
            {
                "field": "",
                "message": "Those fields cannot be written.",
                "details": {"fields": unknown, "editable": sorted(writable)},
            }
        ]

    values: dict[str, Any] = {}
    for name, spec in writable.items():
        field = resource.fields.by_name[name]
        if name not in payload:
            if creating and spec.required:
                problems.append(
                    {
                        "field": name,
                        "message": f"{field.title} is required.",
                        "details": {"field": name},
                    }
                )
            continue
        try:
            value = _value(session, field, spec, payload[name])
        except ValidationError as problem:
            # Every value error already names its field and carries the value,
            # so a row-level report needs nothing this loop has to invent.
            problems.append(
                {
                    "field": name,
                    "message": problem.message,
                    "details": dict(problem.details),
                }
            )
            continue
        if value is None and spec.required:
            problems.append(
                {
                    "field": name,
                    "message": f"{field.title} cannot be empty.",
                    "details": {"field": name},
                }
            )
            continue
        values[name] = value

    if not values and not problems:
        problems.append(
            {
                "field": "",
                "message": "Nothing to write.",
                "details": {"editable": sorted(writable)},
            }
        )
    return values, problems


def _coerced(
    session, resource: Resource, payload: dict[str, Any], *, creating: bool
) -> dict[str, Any]:
    """Every writable field the payload names, converted and checked.

    Unknown keys are an error rather than a silent omission: a form that posts
    `assignee` where the field is `assignee_id` otherwise appears to save and
    changes nothing, which is the most expensive kind of bug to report.

    The first problem wins, because that is what a form wants — see `coerce`.
    """
    values, problems = coerce(session, resource, payload, creating=creating)
    if problems:
        first = problems[0]
        raise ValidationError(first["message"], details=first["details"])
    return values


def _value(session, field: Field, spec: Writable, raw: Any) -> Any:
    """One payload value, as the column will store it."""
    if raw is None or (isinstance(raw, str) and not raw.strip()):
        return None

    if field.kind == "enum":
        return _enum(field, raw)
    if field.kind == "bool":
        return _bool(field, raw)
    if field.kind == "number":
        return _number(field, spec, raw)
    if field.kind == "datetime":
        return _moment(field, raw)
    if field.kind == "uuid":
        return _reference(session, field, raw)
    if field.kind == "json":
        return _document(field, raw)
    return _text(field, raw)


def _enum(field: Field, raw: Any) -> str:
    value = str(raw).strip().upper()
    if field.choices and value not in field.choices:
        raise ValidationError(
            f"{value} is not a {field.title.lower()} this record can have.",
            details={"field": field.name, "value": value, "allowed": list(field.choices)},
        )
    return value


def _bool(field: Field, raw: Any) -> bool:
    if isinstance(raw, bool):
        return raw
    value = str(raw).strip().lower()
    if value in ("true", "1", "yes"):
        return True
    if value in ("false", "0", "no"):
        return False
    raise ValidationError(
        f"{field.title} must be true or false.", details={"field": field.name, "value": raw}
    )
