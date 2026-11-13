"""How a dataset's records spread over time, bucketed for a sparkline."""

from __future__ import annotations

from typing import Any

from sqlalchemy import Numeric, func, select
from sqlalchemy import cast as sql_cast

from src.core.errors import ValidationError
from src.services.records.explorer.model import Insight, Resource

#: Buckets in a trend. Enough to see a shape, few enough to read the axis.
TREND_BUCKETS = 30


def _column_of(scope, resource: Resource, name: str):
    """The declared field's column, as it exists on the filtered subquery."""
    field = resource.fields.by_name.get(name)
    if field is None:
        raise ValidationError("Unknown field.", details={"field": name})
    return scope.c[field.column.key]


def _trend(session, scope, resource: Resource, declared: Insight) -> dict[str, Any] | None:
    """Rows — or their value — over time, bucketed by day.

    Only over the range the filtered set actually spans, so a dataset with two
    years of history and a filter selecting last week draws last week rather
    than a flat line with one spike at the end.
    """
    if not declared.trend or declared.trend not in resource.fields.by_name:
        return None

    column = _column_of(scope, resource, declared.trend)
    bucket = func.date_trunc("day", column).label("at")
    measure = func.count().label("value")
    if declared.trend_value and declared.trend_value in resource.fields.by_name:
        measure = func.sum(
            sql_cast(_column_of(scope, resource, declared.trend_value), Numeric)
        ).label("value")

    rows = session.execute(
        select(bucket, measure)
        .select_from(scope)
        .where(column.isnot(None))
        .group_by(bucket)
        .order_by(bucket.desc())
        .limit(TREND_BUCKETS)
    ).all()

    field = resource.fields.by_name[declared.trend]
    return {
        "field": declared.trend,
        "label": field.title,
        "measure": declared.trend_value or "count",
        # Reversed here rather than in the browser: a chart is drawn left to
        # right and the query has to end with a LIMIT on the newest.
        "series": [
            {"name": row.at.date().isoformat(), "value": float(row.value or 0)}
            for row in reversed(rows)
        ],
    }
