"""Running an analysis over a period window."""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from typing import Any

from src.core.clock import now, resolve_range
from src.core.errors import ValidationError
from src.core.query import apply_filters, count_of
from src.core.rules import compile_tree
from src.services.analytics.analysis.clauses import (
    _dimensions,
    _filter_args,
    _limit,
    _measures,
    _totals,
)
from src.services.analytics.analysis.labelling import Window, _describe, _grouped
from src.services.analytics.analysis.vocabulary import (
    AGGREGATIONS,
    CALENDAR_PERIODS,
    PERIODS,
    _default_date_field,
)
from src.services.records.explorer import (
    Resource,
    _base_statement,
    _json_value,
    resource_for,
)


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


def period_window(period: Any) -> Window:
    """The time range an analysis covers.

    A named period ("last_30_days") or an explicit pair. Named ones are
    resolved on the server so the tile, the chart and the list it drills into
    cannot each pick their own idea of "this month".
    """
    if period in (None, "", "all_time"):
        return Window("all_time", None, None)
    if isinstance(period, str):
        if period in CALENDAR_PERIODS:
            start, end = resolve_range(period)
            return Window(period, start, end)
        days = PERIODS.get(period)
        if days is None:
            raise ValidationError(
                "Unknown period.",
                details={"period": period, "allowed": sorted([*PERIODS, *CALENDAR_PERIODS])},
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
