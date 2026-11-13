"""One filter as a SQL predicate."""

from __future__ import annotations

from typing import Any

from sqlalchemy import and_, func, or_

from src.core.errors import ValidationError
from src.core.query.fields import Field
from src.core.query.operators import (
    OPERATORS,
    OPERATORS_BY_KIND,
    _blank,
    canonical_operator,
)
from src.core.query.values import _moment, _typed, _values


def build_predicate(spec: Field, operator: str, raw: Any):
    """One field, one operator, one value → a SQLAlchemy predicate.

    Returns None when the clause would select every row, so a caller can skip
    it instead of appending `WHERE true`.
    """
    op = canonical_operator(operator)
    column = spec.expression
    allowed = OPERATORS_BY_KIND.get(spec.kind, OPERATORS)
    if op not in allowed:
        raise ValidationError(
            f"{op!r} cannot be applied to {spec.name!r} ({spec.kind}); "
            "use one of " + ", ".join(sorted(allowed))
        )

    # Presence operators ignore the value entirely.
    if op in ("empty", "not_exists"):
        return _blank(column, spec.kind)
    if op in ("not_empty", "exists"):
        return ~_blank(column, spec.kind)

    if isinstance(raw, (list, tuple)):
        values = [str(v).strip() for v in raw if str(v).strip() != ""]
    else:
        values = _values(str(raw), name=spec.name) if raw is not None else []
    if not values:
        return None

    if op == "between":
        if len(values) < 2:
            raise ValidationError(f"{spec.name} between needs two values")
        low, high = _typed(spec, values[:2])
        if low > high:
            low, high = high, low
        return and_(column >= low, column <= high)

    if op in ("gt", "gte", "lt", "lte", "before", "after"):
        bound = _typed(spec, values[:1])[0]
        return {
            "gt": column > bound,
            "after": column > bound,
            "gte": column >= bound,
            "lt": column < bound,
            "before": column < bound,
            "lte": column <= bound,
        }[op]

    if op == "eq":
        # Case-insensitive for text, because a filter box is not a database
        # console and nobody types a name with the right capitals.
        if spec.kind in ("text", "json", "array"):
            return or_(*(func.lower(column) == v.lower() for v in values))
        return column.in_(_typed(spec, values))

    if op == "ne":
        if spec.kind in ("text", "json", "array"):
            # A row with no value is not "equal to X", so it must survive a
            # "not equal to X" filter.
            return and_(*(or_(column.is_(None), func.lower(column) != v.lower()) for v in values))
        return or_(column.is_(None), column.notin_(_typed(spec, values)))

    if op == "in":
        if spec.kind in ("text", "json", "array"):
            return or_(*(func.lower(column) == v.lower() for v in values))
        return column.in_(_typed(spec, values))

    if op == "not_in":
        if spec.kind in ("text", "json", "array"):
            return and_(*(or_(column.is_(None), func.lower(column) != v.lower()) for v in values))
        return or_(column.is_(None), column.notin_(_typed(spec, values)))

    if op == "not":
        # Excluding a value must not also exclude every row that has none: a
        # task with no description is not "a task containing 'urgent'".
        return and_(*(or_(column.is_(None), ~column.ilike(f"%{v}%")) for v in values))

    if op == "starts":
        return or_(*(column.ilike(f"{v}%") for v in values))

    if op == "ends":
        return or_(*(column.ilike(f"%{v}") for v in values))

    # contains
    return or_(*(column.ilike(f"%{v}%") for v in values))


def _default_predicate(spec: Field, raw: Any):
    """The clause a bare `?field=value` means, per kind."""
    values = _values(raw, name=spec.name)
    if not values:
        return None
    column = spec.expression

    if spec.kind == "bool":
        lowered = values[0].lower()
        if lowered not in ("true", "false"):
            raise ValidationError(f"{spec.name} must be true or false")
        return column.is_(lowered == "true")

    if spec.kind in ("enum", "uuid", "number"):
        return column.in_(_typed(spec, values))

    if spec.kind == "datetime":
        # A bare datetime filter is a same-day match; ranges use _from/_to.
        moment = _moment(values[0], name=spec.name)
        return func.date_trunc("day", column) == func.date_trunc("day", moment)

    return or_(*(column.ilike(f"%{v}%") for v in values))
