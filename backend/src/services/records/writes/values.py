"""Typed values: numbers, moments, documents, references, text."""

from __future__ import annotations

from datetime import UTC, date, datetime
from decimal import Decimal, InvalidOperation
from typing import Any
from uuid import UUID

from sqlalchemy import Integer, Numeric, String, Text, func, select

from src.core.errors import NotFoundError, ValidationError
from src.core.pagination import parse_uuid
from src.core.query import Field
from src.services.records.explorer import Writable


def _number(field: Field, spec: Writable, raw: Any) -> Any:
    try:
        number = Decimal(str(raw).strip())
    except (InvalidOperation, ValueError) as exc:
        raise ValidationError(
            f"{field.title} must be a number.", details={"field": field.name, "value": raw}
        ) from exc

    if spec.minimum is not None and number < Decimal(str(spec.minimum)):
        raise _out_of_range(field, spec, number)
    if spec.maximum is not None and number > Decimal(str(spec.maximum)):
        raise _out_of_range(field, spec, number)

    # An `Integer` column given 3.7 stores 3 without complaint in some drivers
    # and raises in others; rounding here means one answer everywhere.
    column_type = getattr(field.column, "type", None)
    if isinstance(column_type, Integer):
        return int(number.to_integral_value())
    if isinstance(column_type, Numeric):
        return number
    return float(number)


def _out_of_range(field: Field, spec: Writable, value: Decimal) -> ValidationError:
    low = "" if spec.minimum is None else f"{spec.minimum:g}"
    high = "" if spec.maximum is None else f"{spec.maximum:g}"
    span = f"between {low} and {high}" if low and high else (f"at least {low}" if low else f"at most {high}")
    return ValidationError(
        f"{field.title} must be {span}.",
        details={"field": field.name, "value": float(value),
                 "minimum": spec.minimum, "maximum": spec.maximum},
    )


def _moment(field: Field, raw: Any) -> datetime:
    """An ISO date or timestamp, stored as an aware UTC moment.

    A bare date is accepted because a date input sends one, and midnight UTC
    is what "due on the 14th" means to a column that has to sort.
    """
    text = str(raw).strip().replace("Z", "+00:00")
    try:
        parsed: date | datetime = datetime.fromisoformat(text)
    except ValueError:
        try:
            parsed = date.fromisoformat(text)
        except ValueError as exc:
            raise ValidationError(
                f"{field.title} must be a date or timestamp.",
                details={"field": field.name, "value": raw},
            ) from exc
    if not isinstance(parsed, datetime):
        parsed = datetime.combine(parsed, datetime.min.time())
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)


#: A checklist longer than this is a project, not a card (§18).
MAX_ITEMS = 50


#: One to-do line. Longer than this and it belongs in the description.
MAX_ITEM_CHARS = 200


def _document(field: Field, raw: Any) -> Any:
    """A JSON field, validated as the shape the page actually renders.

    Only lists of `{text, done}` today, because the one declared JSON writable
    is a checklist. Storing whatever arrives would make the column a place any
    client could put anything — which is how a JSONB column becomes a second,
    undocumented schema.
    """
    if not isinstance(raw, (list, tuple)):
        raise ValidationError(
            f"{field.title} must be a list of items.", details={"field": field.name}
        )
    if len(raw) > MAX_ITEMS:
        raise ValidationError(
            f"{field.title} holds at most {MAX_ITEMS} items.",
            details={"field": field.name, "count": len(raw), "maximum": MAX_ITEMS},
        )

    items = []
    for entry in raw:
        if not isinstance(entry, dict):
            raise ValidationError(
                f"Each {field.title.lower()} item must be an object.",
                details={"field": field.name},
            )
        text = str(entry.get("text") or "").strip()
        if not text:
            raise ValidationError(
                f"A {field.title.lower()} item needs text.", details={"field": field.name}
            )
        if len(text) > MAX_ITEM_CHARS:
            raise ValidationError(
                f"A {field.title.lower()} item is at most {MAX_ITEM_CHARS} characters.",
                details={"field": field.name, "length": len(text)},
            )
        items.append({"text": text, "done": bool(entry.get("done", False))})
    return items


def _reference(session, field: Field, raw: Any) -> UUID:
    """A foreign key, checked against the table the schema says it points at."""
    value = parse_uuid(raw, field=field.name)
    target = _target_of(field)
    if target is None:  # pragma: no cover - a declared uuid that is not an FK
        return value

    model, column = target
    statement = select(func.count()).select_from(model).where(column == value)
    deleted = getattr(model, "deleted_at", None)
    if deleted is not None:
        statement = statement.where(deleted.is_(None))
    if not session.scalar(statement):
        raise NotFoundError(
            f"No {field.title.removesuffix(' ID').lower()} with that id.",
            details={"field": field.name, "value": str(value)},
        )
    return value


def _target_of(field: Field) -> tuple[Any, Any] | None:
    """The (model, primary key column) a foreign-key field points at.

    Read off the column's own `ForeignKey` rather than a mapping kept here: a
    second description of the schema is wrong the first time anybody migrates.
    """
    from src.models.base import Base

    keys = getattr(field.column, "foreign_keys", set()) or set()
    for key in keys:
        table = key.column.table
        for mapper in Base.registry.mappers:
            if mapper.local_table is not None and mapper.local_table.name == table.name:
                return mapper.class_, getattr(mapper.class_, key.column.name)
    return None


def _text(field: Field, raw: Any) -> str:
    value = str(raw).strip()
    column_type = getattr(field.column, "type", None)
    limit = getattr(column_type, "length", None) if isinstance(column_type, (String, Text)) else None
    if limit and len(value) > limit:
        raise ValidationError(
            f"{field.title} is longer than {limit} characters.",
            details={"field": field.name, "length": len(value), "maximum": limit},
        )
    return value
