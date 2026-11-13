"""Sample rows, and the notes on a dataset."""

from __future__ import annotations

from typing import Any

from sqlalchemy import String, cast, func, select

from src.core.errors import ValidationError
from src.services.records.explorer import resources


def sample(session, key: Any, *, principal, field: str) -> dict[str, Any]:
    """The values a field actually holds, most common first.

    The catalogue's honest answer to "what can I put in this filter?" — the
    declared choices are what the code allows, and this is what the data has.
    """
    resource = resources().get(str(key or ""))
    if resource is None:
        raise ValidationError("Unknown dataset.", details={"resource_type": str(key or "")})
    principal.require(resource.permission)

    spec = resource.fields.by_name.get(str(field or ""))
    if spec is None:
        raise ValidationError(
            "Unknown field.",
            details={"field": str(field or ""), "available": sorted(resource.fields.by_name)},
        )

    deleted = getattr(resource.model, "deleted_at", None)
    column = cast(spec.column, String)
    statement = (
        select(column.label("value"), func.count().label("count"))
        .where(spec.column.is_not(None))
        .group_by(column)
        .order_by(func.count().desc())
        .limit(20)
    )
    if deleted is not None:
        statement = statement.where(deleted.is_(None))

    return {
        "resource_type": resource.key,
        "field": spec.name,
        "label": spec.title,
        "values": [
            {"value": row.value, "count": int(row.count)}
            for row in session.execute(statement).all()
        ],
    }
