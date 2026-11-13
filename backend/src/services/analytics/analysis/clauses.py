"""The dimensions, measures, filters and totals an analysis selects."""

from __future__ import annotations

from typing import Any

from sqlalchemy import Numeric, cast, func, select

from src.core.errors import ValidationError
from src.core.query import Field
from src.services.analytics.analysis.vocabulary import (
    _AGGREGATION_WORDS,
    AGGREGATIONS,
    DEFAULT_LIMIT,
    DIMENSION_KINDS,
    GRANULARITIES,
    MAX_LIMIT,
    MEASURE_KINDS,
    TIMESERIES_LIMIT,
    Dimension,
    Measure,
)
from src.services.records.explorer import Resource


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


def _number(value: Any) -> Any:
    if value is None:
        return 0
    try:
        number = float(value)
    except (TypeError, ValueError):  # pragma: no cover - aggregates are numeric
        return 0
    return int(number) if number.is_integer() else round(number, 2)
