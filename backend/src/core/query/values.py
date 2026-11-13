"""Filter values coerced to a field's kind."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from src.core.errors import ValidationError
from src.core.query.fields import MAX_FILTER_CHARS, MAX_FILTER_VALUES, Field


def _as_text(raw: Any) -> str:
    """One filter value as the comma-separated string every reader expects.

    Filters arrive from two places with two shapes: a query string, where
    `?status=A,B` is already text, and a JSON request body, where the same
    filter is `["A", "B"]`. Stringifying the list without this produces
    `"['A', 'B']"` and a WHERE clause that matches nothing at all — a filter
    that silently returns an empty table rather than failing.
    """
    if isinstance(raw, (list, tuple, set)):
        return ",".join(str(value) for value in raw)
    return str(raw)


def _values(raw: Any, *, name: str) -> list[str]:
    text = _as_text(raw)
    if len(text) > MAX_FILTER_CHARS:
        raise ValidationError(f"{name} filter must be at most {MAX_FILTER_CHARS} characters")
    values = [part.strip() for part in text.split(",") if part.strip()]
    if len(values) > MAX_FILTER_VALUES:
        raise ValidationError(f"{name} accepts at most {MAX_FILTER_VALUES} values")
    return values


def _number(raw: Any, *, name: str) -> float:
    try:
        return float(raw)
    except (TypeError, ValueError) as exc:
        raise ValidationError(f"{name} must be a number") from exc


def _moment(raw: Any, *, name: str) -> datetime:
    text = str(raw).strip().replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError as exc:
        raise ValidationError(f"{name} must be an ISO-8601 date or timestamp") from exc
    # A naive boundary from a date picker means "that instant in UTC"; leaving
    # it naive makes PostgreSQL compare it against a tz-aware column and fail.
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)


def _uuids(values: list[str], *, name: str) -> list[UUID]:
    try:
        return [UUID(str(value)) for value in values]
    except (TypeError, ValueError) as exc:
        raise ValidationError(f"{name} must contain only UUIDs") from exc


def _typed(spec: Field, values: list[str]):
    """Coerce raw strings to the column's Python type for exact comparison."""
    if spec.kind == "uuid":
        return _uuids(values, name=spec.name)
    if spec.kind == "number":
        return [_number(v, name=spec.name) for v in values]
    if spec.kind == "datetime":
        return [_moment(v, name=spec.name) for v in values]
    if spec.kind == "bool":
        return [str(v).lower() in ("true", "1", "yes") for v in values]
    return values
