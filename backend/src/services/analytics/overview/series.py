"""Time series: the bucket a period is drawn in, plain and grouped by a column."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import and_, func, select

from src.core.clock import iso
from src.services.analytics.overview.measures import _live

#: The week as a reader reads it, Monday first. The heatmap's vertical axis.
WEEKDAYS: tuple[str, ...] = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")


#: The same names indexed the way PostgreSQL's `extract('dow')` counts, which
#: starts on Sunday. Kept beside `WEEKDAYS` rather than inline at the call
#: site, because two orderings of the same seven strings a hundred lines apart
#: is how a chart ends up one day out.
_POSTGRES_WEEKDAYS: tuple[str, ...] = ("Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat")


def _bucket(start: datetime, end: datetime) -> str:
    """Day, week or month, chosen so a chart has 7–40 points.

    Ninety daily points on a 600px chart is a solid block of ink; twelve is a
    trend somebody can read.
    """
    span = (end - start).days
    if span <= 45:
        return "day"
    if span <= 400:
        return "week"
    return "month"


def _series(session, column, value_column, start: datetime, end: datetime, *clauses):
    grain = _bucket(start, end)
    bucket = func.date_trunc(grain, column)
    stmt = select(bucket.label("bucket"), value_column.label("value")).where(
        and_(column >= start, column < end)
    )
    for clause in (*_live(column), *clauses):
        stmt = stmt.where(clause)
    stmt = stmt.group_by(bucket).order_by(bucket)
    return [
        {"bucket": iso(row.bucket), "value": float(row.value or 0)}
        for row in session.execute(stmt).all()
    ]


def _grouped_series(
    session,
    column,
    group_column,
    start: datetime,
    end: datetime,
    *clauses,
    value_column=None,
    limit: int = 5,
):
    """A time series split by a second dimension — the stacked shapes.

    Two GROUP BYs rather than one query per group: "orders by channel over
    twelve weeks" is one statement, and asking it five times because the chart
    has five stacks is five times the work for the same answer.

    The measure is a parameter, defaulting to counting rows, because "how many
    orders by channel" and "how much revenue by channel" are the same shape
    asked of a different column — and a second function differing by one
    expression is a second place to fix the `Other` fold.

    The groups are capped and the tail folded into `Other`, because a stack of
    twenty is a colour wheel, and because the palette only has ten colours that
    are distinguishable from one another.
    """
    grain = _bucket(start, end)
    bucket = func.date_trunc(grain, column)
    measure = func.count() if value_column is None else value_column
    statement = (
        select(bucket.label("bucket"), group_column.label("group"), measure.label("value"))
        .where(and_(column >= start, column < end))
        .group_by(bucket, group_column)
        .order_by(bucket)
    )
    for clause in (*_live(column, group_column), *clauses):
        statement = statement.where(clause)

    rows = session.execute(statement).all()
    totals: dict[str, float] = {}
    for row in rows:
        name = str(row.group or "—")
        totals[name] = totals.get(name, 0) + float(row.value or 0)

    kept = [name for name, _ in sorted(totals.items(), key=lambda item: -item[1])[:limit]]
    # Fold the tail per bucket so chart, table and CSV contain the same cells.
    cells: dict[tuple[str, str], float] = {}
    for row in rows:
        name = str(row.group or "—")
        key = (iso(row.bucket), name if name in kept else "Other")
        cells[key] = cells.get(key, 0) + float(row.value or 0)
    series = [{"bucket": bucket, "group": group, "value": value}
              for (bucket, group), value in cells.items()]
    groups = [*kept, "Other"] if len(totals) > len(kept) else kept
    return series, groups
