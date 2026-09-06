"""Grouped aggregation over any declared dataset (§2, §28, §44, §71).

Four screens ask the same question in different clothes: the analytics
workspace ("revenue by month"), the report builder ("orders by channel and
status, summed"), the chart builder ("draw that as a treemap") and the map
("by country"). They are one query — *group these rows by these columns and
measure them this way* — so there is one compiler here rather than four
endpoints that will disagree about what "last 30 days" means.

Three properties make it safe to expose that generality:

**Everything comes from the declaration.** A dimension must be a declared
field, a measure must be a declared numeric one, and the filters go through the
same `apply_filters` and `compile_tree` every list uses. A caller cannot name a
column that is not published, and permission is checked on the resource before
anything is compiled.

**It aggregates in PostgreSQL.** Summing the rows a page happened to download
gives "revenue: 41 000" for a dataset holding four million — not a smaller
version of the right answer but a wrong one (§71).

**The tail is collapsed, never dropped.** A breakdown of forty industries is a
colour wheel, so the long tail becomes one named row that still adds up to the
total. A chart whose slices do not reconcile with the list beside it is a chart
nobody believes twice.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from typing import Any

from sqlalchemy import Numeric, String, cast, func, select

from src.core.clock import now
from src.core.errors import ValidationError
from src.core.query import Field, apply_filters, count_of
from src.core.rules import compile_tree
from src.services.explorer import Resource, _base_statement, _json_value, resource_for

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
    from src.services.explorer import resources

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
        ],
    }


def run(session, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    """Group, measure and return — the whole analysis, computed in SQL."""
    if not isinstance(payload, dict):
        raise ValidationError("The analysis must be a JSON object.")

    resource = resource_for(payload.get("resource_type"), principal=principal)
    dimensions = _dimensions(resource, payload)
    measures = _measures(resource, payload)
    window = period_window(payload.get("period"))

    statement = apply_filters(_base_statement(resource), _filter_args(payload), resource.fields)
    predicate = compile_tree(payload.get("condition_tree"), resource.fields)
    if predicate is not None:
        statement = statement.where(predicate)
    statement = _within(statement, resource, payload, window)

    matched = count_of(session, statement)
    totals = _totals(session, statement, measures)

    over_time = bool(dimensions and dimensions[0].granularity)
    rows, truncated, tail = _grouped(
        session, statement, dimensions, measures, _limit(payload, over_time),
    )

    return {
        "resource_type": resource.key,
        "resource_label": resource.label,
        "path": resource.path,
        "dimensions": [
            {"field": item.field.name, "label": item.label, "kind": item.field.kind,
             "granularity": item.granularity}
            for item in dimensions
        ],
        "measures": [
            {"key": item.key, "label": item.label, "aggregation": item.aggregation,
             "field": item.field.name if item.field else "",
             "format": AGGREGATIONS[item.aggregation]}
            for item in measures
        ],
        "rows": rows,
        "totals": totals,
        "matched": matched,
        # The tail is reported, not silently absent: a reader has to be able to
        # reconcile the chart with the total beside it.
        "truncated": truncated,
        "other": tail,
        "period": {
            "key": window.key,
            "field": _period_field(resource, payload),
            "from": window.start.isoformat() if window.start else None,
            "to": window.end.isoformat() if window.end else None,
        },
        "description": _describe(resource, dimensions, measures, window),
        "generated_at": _json_value(now()),
    }


# ── the window ───────────────────────────────────────────────────────────


@dataclass(frozen=True, slots=True)
class Window:
    key: str
    start: datetime | None
    end: datetime | None


def period_window(period: Any) -> Window:
    """The time range an analysis covers.

    A named period ("last_30_days") or an explicit pair. Named ones are
    resolved on the server so the tile, the chart and the list it drills into
    cannot each pick their own idea of "this month".
    """
    if period in (None, "", "all_time"):
        return Window("all_time", None, None)
    if isinstance(period, str):
        days = PERIODS.get(period)
        if days is None:
            raise ValidationError(
                "Unknown period.", details={"period": period, "allowed": sorted(PERIODS)},
            )
        end = now()
        return Window(period, end - timedelta(days=days), end)
    if isinstance(period, dict):
        return Window(
            str(period.get("key") or "custom"),
            _moment(period.get("from"), "period.from"),
            _moment(period.get("to"), "period.to"),
        )
    raise ValidationError("period must be a name or an object.", details={"period": str(period)})


def _moment(value: Any, field: str) -> datetime | None:
    if value in (None, ""):
        return None
    try:
        parsed: date | datetime = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        try:
            parsed = date.fromisoformat(str(value))
        except ValueError as exc:
            raise ValidationError(f"{field} must be a date.", details={field: str(value)}) from exc
    if not isinstance(parsed, datetime):
        parsed = datetime.combine(parsed, datetime.min.time())
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)


def _within(statement, resource: Resource, payload: dict[str, Any], window: Window):
    if window.start is None and window.end is None:
        return statement
    name = _period_field(resource, payload)
    field = resource.fields.by_name.get(name)
    if field is None or field.kind != "datetime":
        raise ValidationError(
            "That dataset has no date to measure a period against.",
            details={"resource_type": resource.key, "field": name},
        )
    if window.start is not None:
        statement = statement.where(field.column >= window.start)
    if window.end is not None:
        statement = statement.where(field.column <= window.end)
    return statement


def _period_field(resource: Resource, payload: dict[str, Any]) -> str:
    period = payload.get("period")
    named = period.get("field") if isinstance(period, dict) else None
    return str(payload.get("date_field") or named or _default_date_field(resource))


def _default_date_field(resource: Resource) -> str:
    """The date a period means for this dataset, when nobody said.

    The trend field the resource already declares, so "last 30 days" of orders
    means placed, not last-updated — which is the difference between revenue
    and edit activity.
    """
    if resource.insight.trend:
        return resource.insight.trend
    return "created_at" if "created_at" in resource.fields.by_name else ""


# ── the query ────────────────────────────────────────────────────────────


def _dimensions(resource: Resource, payload: dict[str, Any]) -> list[Dimension]:
    raw = payload.get("dimensions") or []
    if not isinstance(raw, (list, tuple)):
        raise ValidationError("dimensions must be an array of field names.")
    if len(raw) > 2:
        # Two is what a chart can draw — a series and a stack. A third is a
        # pivot table, which is a different screen and a different endpoint.
        raise ValidationError(
            "An analysis groups by at most two fields.", details={"dimensions": list(raw)},
        )

    out: list[Dimension] = []
    for entry in raw:
        name = entry.get("field") if isinstance(entry, dict) else entry
        granularity = str(entry.get("granularity") or "") if isinstance(entry, dict) else ""
        field = resource.fields.by_name.get(str(name or ""))
        if field is None or field.kind not in DIMENSION_KINDS:
            raise ValidationError(
                f"{name} cannot be grouped by.",
                details={
                    "field": str(name or ""),
                    "available": [
                        item.name for item in resource.fields.fields
                        if item.kind in DIMENSION_KINDS and item.filterable
                    ],
                },
            )
        if granularity and granularity not in GRANULARITIES:
            raise ValidationError(
                "Unknown granularity.",
                details={"granularity": granularity, "allowed": list(GRANULARITIES)},
            )
        if granularity and field.kind != "datetime":
            raise ValidationError(
                "Only a date can be bucketed.", details={"field": field.name},
            )
        # A date grouped without a bucket is one row per instant, which is not
        # an analysis. Default to the month, which is what people mean.
        if field.kind == "datetime" and not granularity:
            granularity = "month"
        out.append(Dimension(field, granularity))
    return out


def _measures(resource: Resource, payload: dict[str, Any]) -> list[Measure]:
    raw = payload.get("measures") or payload.get("metrics") or []
    if not isinstance(raw, (list, tuple)):
        raise ValidationError("measures must be an array.")
    if not raw:
        # Counting rows is the analysis nobody has to ask for.
        return [Measure("count", "Record count", "count", None)]
    if len(raw) > 4:
        raise ValidationError("An analysis computes at most four measures.")

    out: list[Measure] = []
    for entry in raw:
        if isinstance(entry, str):
            entry = {"aggregation": "count"} if entry == "count" else {"aggregation": "sum", "field": entry}
        if not isinstance(entry, dict):
            raise ValidationError("Each measure must be an object or a field name.")
        aggregation = str(entry.get("aggregation") or entry.get("kind") or "count").lower()
        if aggregation not in AGGREGATIONS:
            raise ValidationError(
                "Unknown aggregation.",
                details={"aggregation": aggregation, "allowed": sorted(AGGREGATIONS)},
            )
        if aggregation == "count":
            out.append(Measure("count", "Record count", "count", None))
            continue
        name = str(entry.get("field") or "")
        field = resource.fields.by_name.get(name)
        if field is None or field.kind not in MEASURE_KINDS:
            raise ValidationError(
                f"{name} cannot be measured.",
                details={
                    "field": name,
                    "available": [
                        item.name for item in resource.fields.fields
                        if item.kind in MEASURE_KINDS
                    ],
                },
            )
        out.append(Measure(f"{aggregation}:{name}", _measure_label(aggregation, field),
                           aggregation, field))
    return out


def _measure_label(aggregation: str, field: Field) -> str:
    """What the number is called, rather than which function produced it.

    A column already named "Total" does not become "total total": the word is
    prefixed only when the field does not already say it.
    """
    word = _AGGREGATION_WORDS[aggregation]
    title = field.title.lower()
    return title if title.startswith(word) else f"{word} {title}"


def _filter_args(payload: dict[str, Any]) -> dict[str, Any]:
    filters = payload.get("filters") or {}
    if not isinstance(filters, dict):
        raise ValidationError("filters must be an object.")
    args = dict(filters)
    if payload.get("query_text"):
        args["q"] = payload["query_text"]
    return args


def _limit(payload: dict[str, Any], over_time: bool = False) -> int:
    ceiling = TIMESERIES_LIMIT if over_time else MAX_LIMIT
    try:
        limit = int(payload.get("limit") or (ceiling if over_time else DEFAULT_LIMIT))
    except (TypeError, ValueError) as exc:
        raise ValidationError("limit must be a number.") from exc
    return max(1, min(limit, ceiling))


def _totals(session, statement, measures: list[Measure]) -> dict[str, Any]:
    """Every measure over the whole selection, unGROUPed.

    Computed separately rather than summed from the rows, because an average of
    averages is not an average and a collapsed tail would be missing from it.
    """
    subquery = statement.subquery()
    columns = [_over(subquery, measure).label(measure.key) for measure in measures]
    # `select_from` explicitly: `select(func.count())` carries no FROM of its
    # own, and without this it counts one row rather than the selection's.
    row = session.execute(select(*columns).select_from(subquery)).one()
    return {measure.key: _number(value) for measure, value in zip(measures, row, strict=True)}


def _over(subquery, measure: Measure):
    """A measure applied to a subquery's column rather than the mapped one."""
    if measure.aggregation == "count":
        return func.count()
    column = subquery.c[measure.field.name]  # type: ignore[union-attr]
    return getattr(func, measure.aggregation)(cast(column, Numeric))


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


def _number(value: Any) -> Any:
    if value is None:
        return 0
    try:
        number = float(value)
    except (TypeError, ValueError):  # pragma: no cover - aggregates are numeric
        return 0
    return int(number) if number.is_integer() else round(number, 2)


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


def _period_label(key: str) -> str:
    if key == "all_time":
        return "All time"
    if key == "custom":
        return "Custom range"
    days = PERIODS.get(key)
    return f"Last {days} days" if days else key.replace("_", " ")
