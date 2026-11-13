"""What can be asked: aggregations, dimensions, measures and periods."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from src.core.clock import resolve_range
from src.core.query import Field
from src.services.records.explorer import Resource

#: Rows returned before the tail is folded into one named row.
DEFAULT_LIMIT = 12


MAX_LIMIT = 200


#: A time series is not a top-N. Its rows are buckets, they read in order, and
#: folding the oldest months into "Other" would be a line chart with a hole in
#: it — so it gets its own, far larger bound: a year of days, plus room.
TIMESERIES_LIMIT = 400


#: How a date dimension may be bucketed. `date_trunc` names, so the SQL is the
#: vocabulary rather than a translation of it.
GRANULARITIES = ("day", "week", "month", "quarter", "year")


#: The periods the analytics workspace offers, in days back from now. Declared
#: rather than computed by the client: "last 30 days" has to mean the same
#: thing to the tile, the chart beneath it and the list it drills into (§44).
PERIODS: dict[str, int] = {
    "last_7_days": 7,
    "last_30_days": 30,
    "last_90_days": 90,
    "last_180_days": 180,
    "last_365_days": 365,
}


#: Calendar periods — the dashboard's period picker offers these beside the
#: rolling ones (`services.dashboard.PERIODS`), and a widget that follows its
#: dashboard hands the engine whatever was picked there. Rejecting them made
#: every seeded "This month" dashboard draw its widgets as errors. Resolved by
#: `core.clock.resolve_range`, the one place "this month" is defined, so the
#: KPI header and the chart underneath it agree.
CALENDAR_PERIODS: dict[str, str] = {
    "today": "Today",
    "yesterday": "Yesterday",
    "current_month": "This month",
    "previous_month": "Last month",
    "current_year": "This year",
    "previous_year": "Last year",
}


#: What a measure can do to a column, and how the result should be read.
AGGREGATIONS: dict[str, str] = {
    "count": "number",
    "sum": "number",
    "avg": "number",
    "min": "number",
    "max": "number",
}


#: Kinds that group meaningfully. A UUID groups into one row per record, which
#: is a list rather than an analysis; free text is offered because industry and
#: location are text columns people genuinely group by.
DIMENSION_KINDS = frozenset({"enum", "text", "bool", "datetime"})


#: Kinds that measure. Only numbers, plus `count`, which measures rows.
MEASURE_KINDS = frozenset({"number"})


#: The label the collapsed tail carries.
OTHER = "Other"


#: How each aggregation reads in a heading. "Sum of total" is what the SQL
#: does; "total" is what the reader calls the number, and a panel titled with
#: the function name rather than the quantity is a panel written for the author.
_AGGREGATION_WORDS = {
    "sum": "total", "avg": "average", "min": "lowest", "max": "highest",
}


@dataclass(frozen=True, slots=True)
class Measure:
    """One number an analysis computes, resolved against the declaration."""

    key: str
    label: str
    aggregation: str
    #: `None` for `count`, which measures rows rather than a column.
    field: Field | None


@dataclass(frozen=True, slots=True)
class Dimension:
    """One grouping column, with the bucket it is read in when it is a date."""

    field: Field
    granularity: str = ""

    @property
    def label(self) -> str:
        return self.field.title if not self.granularity else f"{self.field.title} by {self.granularity}"


def catalogue(*, principal) -> dict[str, Any]:
    """What can be grouped, what can be measured, and over which periods.

    Derived from the same `Resource` declarations the explorer publishes, so a
    field that appears in the query builder appears here the same day — and one
    that is removed disappears from both.
    """
    from src.services.records.explorer import resources

    datasets = []
    for resource in resources().values():
        if not principal.can(resource.permission):
            continue
        datasets.append({
            "key": resource.key,
            "label": resource.label,
            "description": resource.description,
            "path": resource.path,
            "dimensions": [
                {"name": field.name, "label": field.title, "kind": field.kind,
                 "choices": list(field.choices)}
                for field in resource.fields.fields
                if field.kind in DIMENSION_KINDS and field.filterable
            ],
            "measures": [
                {"name": field.name, "label": field.title}
                for field in resource.fields.fields
                if field.kind in MEASURE_KINDS
            ],
            "dates": [
                {"name": field.name, "label": field.title}
                for field in resource.fields.fields
                if field.kind == "datetime"
            ],
            "default_date": _default_date_field(resource),
        })

    return {
        "datasets": datasets,
        "aggregations": [
            {"key": key, "label": key.title(), "format": fmt}
            for key, fmt in AGGREGATIONS.items()
        ],
        "granularities": list(GRANULARITIES),
        "periods": [
            {"key": key, "label": _period_label(key), "days": days}
            for key, days in PERIODS.items()
        ]
        + [
            {"key": key, "label": label, "days": _calendar_days(key)}
            for key, label in CALENDAR_PERIODS.items()
        ],
    }


def _default_date_field(resource: Resource) -> str:
    """The date a period means for this dataset, when nobody said.

    The trend field the resource already declares, so "last 30 days" of orders
    means placed, not last-updated — which is the difference between revenue
    and edit activity.
    """
    if resource.insight.trend:
        return resource.insight.trend
    return "created_at" if "created_at" in resource.fields.by_name else ""


def _period_label(key: str) -> str:
    if key == "all_time":
        return "All time"
    if key == "custom":
        return "Custom range"
    if key in CALENDAR_PERIODS:
        return CALENDAR_PERIODS[key]
    days = PERIODS.get(key)
    return f"Last {days} days" if days else key.replace("_", " ")


def _calendar_days(key: str) -> int:
    """How many days a calendar period spans today, rounded up — for a client
    that sizes a chart's axis by the period's length."""
    start, end = resolve_range(key)
    return max(1, -(-int((end - start).total_seconds()) // 86400))
