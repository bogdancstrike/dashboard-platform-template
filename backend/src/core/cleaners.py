"""Reusable field cleaners for `core.validation` schemas.

Each factory returns a `(value, ctx) -> cleaned` function. Messages are
always the caller's: they are what the client shows, so a schema keeps the
exact wording its endpoint has always answered with.
"""

from __future__ import annotations

from typing import Any, Callable, Iterable, NoReturn

from src.core.errors import ValidationError
from src.core.pagination import parse_uuid

Error = Callable[[str, tuple], ValidationError]


def fail(message: str, **details: Any) -> NoReturn:
    raise ValidationError(message, details=details or None)


def collapse(value: Any) -> str:
    """Whitespace runs to one space, ends trimmed."""
    return " ".join(str(value or "").split())


def blank(value: Any) -> bool:
    return value is None or value == ""


def text(limit: int | None = None, *, squash: bool = False, empty: Any = "",
         required: str | None = None, details: dict[str, Any] | None = None,
         fallback: str | None = None):
    """Trimmed text cut to `limit`; empty is `empty`, or refused with `required`."""

    def clean(value: Any, ctx=None) -> Any:
        raw = value if fallback is None else (value or fallback)
        out = collapse(raw) if squash else str(raw or "").strip()
        if not out:
            if required is not None:
                raise ValidationError(required, details=details)
            return empty
        return out[:limit] if limit else out

    return clean


def bounded_name(field: str = "name", maximum: int = 200):
    """Collapsed text of 1..maximum characters; longer is refused, not cut."""

    def clean(value: Any, ctx=None) -> str:
        out = collapse(value)
        if not out or len(out) > maximum:
            fail(f"{field} must contain 1 to {maximum} characters", field=field)
        return out

    return clean


def unknown_named(field: str) -> Error:
    """`Unknown category.` with the value and the allowed list."""
    return lambda value, allowed: ValidationError(
        f"Unknown {field}.", details={field: value, "allowed": list(allowed)})


def not_a(field: str) -> Error:
    """`That is not a severity.` with the value and the allowed list."""
    return lambda value, allowed: ValidationError(
        f"That is not a {field}.", details={field: value, "allowed": list(allowed)})


def one_of_listed(field: str) -> Error:
    """`measure must be one of a, b.` with the field and the allowed list."""
    return lambda value, allowed: ValidationError(
        f"{field} must be one of {', '.join(allowed)}.",
        details={"field": field, "allowed": list(allowed)})


def choice(allowed: Iterable[str], *, error: Error, default: str = "",
           case: Callable[[str], str] = str.upper, strip: bool = False):
    """A value from a closed set, normalised by `case`; absent means `default`."""
    options = tuple(allowed)

    def clean(value: Any, ctx=None) -> str:
        out = str(value or default)
        out = case(out.strip() if strip else out)
        if out not in options:
            raise error(out, options)
        return out

    return clean


def flag(value: Any, ctx=None) -> bool:
    return bool(value)


def optional_uuid(field: str):
    """A UUID, or `None` for an empty value."""
    return lambda value, ctx=None: parse_uuid(value, field=field) if value else None


def whole(message: str, *, details: dict[str, Any] | None = None) -> Callable[[Any], int]:
    def parse(value: Any) -> int:
        try:
            return int(value)
        except (TypeError, ValueError) as exc:
            raise ValidationError(message, details=details) from exc

    return parse


def number(message: str, *, details: dict[str, Any] | None = None) -> Callable[[Any], float]:
    def parse(value: Any) -> float:
        try:
            return float(value)
        except (TypeError, ValueError) as exc:
            raise ValidationError(message, details=details) from exc

    return parse


def within(low: float, high: float, message: str, *, details: dict[str, Any] | None = None):
    def check(value):
        if not low <= value <= high:
            raise ValidationError(message, details=details)
        return value

    return check


def json_object(message: str, *, details: dict[str, Any] | None = None, falsy_is_empty=True):
    """A JSON object; a falsy value (or only `None`) reads as `{}`."""

    def clean(value: Any, ctx=None) -> dict[str, Any]:
        out = (value or {}) if falsy_is_empty else ({} if value is None else value)
        if not isinstance(out, dict):
            raise ValidationError(message, details=details)
        return out

    return clean


def object_or_null(message: str):
    def clean(value: Any, ctx=None) -> dict[str, Any] | None:
        if value is not None and not isinstance(value, dict):
            raise ValidationError(message)
        return value

    return clean


def optional(cleaner):
    """`None` for an empty value, otherwise `cleaner`."""
    return lambda value, ctx=None: None if blank(value) else cleaner(value, ctx)
