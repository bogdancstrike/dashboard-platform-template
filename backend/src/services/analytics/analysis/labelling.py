"""Grouping rows, the remainder, and how periods and keys are labelled."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from typing import Any

from sqlalchemy import String, cast, func, select

from src.services.analytics.analysis.clauses import _number, _over, _totals
from src.services.analytics.analysis.vocabulary import (
    CALENDAR_PERIODS,
    OTHER,
    PERIODS,
    Dimension,
    Measure,
    _period_label,
)
from src.services.records.explorer import Resource


@dataclass(frozen=True, slots=True)
class Window:
    key: str
    start: datetime | None
    end: datetime | None


def _grouped(
    session, statement, dimensions: list[Dimension], measures: list[Measure], limit: int,
) -> tuple[list[dict[str, Any]], bool, dict[str, Any] | None]:
    """The rows, ordered by the first measure, with the tail folded into one."""
    if not dimensions:
        # No grouping: one row, which is what a KPI tile asks for.
        totals = _totals(session, statement, measures)
        return [{"keys": [], "labels": [], "values": totals}], False, None

    subquery = statement.subquery()
    keys = [_key_of(subquery, dimension).label(f"d{index}")
            for index, dimension in enumerate(dimensions)]
    values = [_over(subquery, measure).label(measure.key) for measure in measures]

    #: Time reads in order; everything else reads biggest-first.
    ordering = (
        keys[0].asc() if dimensions[0].granularity else values[0].desc()
    )
    result = session.execute(
        select(*keys, *values).group_by(*keys).order_by(ordering).limit(limit + 1)
    ).all()

    truncated = len(result) > limit
    kept = result[:limit]
    rows = [
        {
            "keys": [_label(dimension, row[index]) for index, dimension in enumerate(dimensions)],
            "values": {
                measure.key: _number(row[len(dimensions) + offset])
                for offset, measure in enumerate(measures)
            },
        }
        for row in kept
    ]

    tail = None
    # A truncated time series has no meaningful tail: the missing rows are
    # buckets outside the drawn range, not a long tail of small values.
    if truncated and not dimensions[0].granularity:
        # What is not on the chart, as one row — so the parts still add to the
        # whole even when only twelve of forty are drawn.
        totals = _totals(session, statement, measures)
        tail = {
            "keys": [OTHER] + [""] * (len(dimensions) - 1),
            "values": {
                measure.key: _remainder(measure, totals, rows)
                for measure in measures
            },
        }
    return rows, truncated, tail


def _remainder(measure: Measure, totals: dict[str, Any], rows: list[dict[str, Any]]) -> Any:
    """The tail's share of a measure — only where subtraction is meaningful.

    Counts and sums decompose; an average, a minimum and a maximum do not, and
    a "remaining average" computed by subtraction is a number that looks right
    and is not.
    """
    if measure.aggregation not in ("count", "sum"):
        return None
    drawn = sum(float(row["values"][measure.key] or 0) for row in rows)
    return _number(float(totals.get(measure.key) or 0) - drawn)


def _key_of(subquery, dimension: Dimension):
    column = subquery.c[dimension.field.name]
    if dimension.granularity:
        return func.date_trunc(dimension.granularity, column)
    if dimension.field.kind in ("bool", "json", "array"):
        return cast(column, String)
    return column


def _label(dimension: Dimension, value: Any) -> str:
    if value is None:
        # An absent value is a finding — "310 of 600 tickets name a customer"
        # — so it gets a name rather than being dropped from the chart.
        return "Not set"
    if isinstance(value, (datetime, date)):
        return value.date().isoformat() if isinstance(value, datetime) else value.isoformat()
    return str(value)


def _describe(
    resource: Resource, dimensions: list[Dimension], measures: list[Measure], window: Window,
) -> str:
    """The analysis as a sentence, for the panel heading and the inspector.

    Written from the same objects the SQL was built from, so it cannot describe
    a different query than the one that ran (§51).
    """
    measured = " and ".join(measure.label.lower() for measure in measures)
    grouped = " and ".join(
        f"{item.granularity} of {item.field.title.lower()}" if item.granularity
        else item.field.title.lower()
        for item in dimensions
    )
    sentence = f"{measured} of {resource.label.lower()}"
    if grouped:
        sentence += f", by {grouped}"
    if window.key != "all_time":
        sentence += f", over the {_period_label(window.key).lower()}"
    return sentence


def known_period(period: Any) -> bool:
    """Whether `period_window` would accept this — the repair's test."""
    return period in (None, "", "all_time") or isinstance(period, dict) or period in PERIODS or period in CALENDAR_PERIODS
