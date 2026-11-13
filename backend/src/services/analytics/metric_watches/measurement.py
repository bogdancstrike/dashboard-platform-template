"""The time series a watch reads from its dataset."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import func, select

from src.core.clock import now
from src.core.errors import ValidationError
from src.core.query import apply_filters
from src.services.analytics.metric_watches.detection import (
    CHANNELS,
    DIRECTIONS,
    GRANULARITIES,
    HISTORY,
    MANAGE,
    MEASURES,
    METHODS,
    SENSITIVITY,
    VIEW,
)


def _resource(dataset: str):
    from src.services.records.explorer import resource_for

    return resource_for(dataset)


def _date_field(resource, name: str | None) -> str:
    candidates = [name, resource.insight.trend, "created_at"]
    for candidate in candidates:
        field = resource.fields.by_name.get(candidate or "")
        if field is not None and field.kind == "datetime":
            return field.name
    raise ValidationError("That dataset has no date to watch over.", details={"dataset": resource.key})


def _floor(moment: datetime, granularity: str) -> datetime:
    moment = moment.astimezone(timezone.utc)
    if granularity == "hour":
        return moment.replace(minute=0, second=0, microsecond=0)
    day = moment.replace(hour=0, minute=0, second=0, microsecond=0)
    if granularity == "week":
        return day - timedelta(days=day.weekday())
    return day


def series(session, config: dict[str, Any], *, until: datetime | None = None, points: int = HISTORY) -> list[dict[str, Any]]:
    """`points` buckets ending with the one `until` falls in, oldest first."""
    resource = _resource(config["dataset"])
    granularity = config["granularity"]
    step = GRANULARITIES[granularity]
    date_name = _date_field(resource, config.get("date_field"))
    column = resource.fields.by_name[date_name].column
    end = _floor(until or now(), granularity)
    start = end - step * (points - 1)

    measure = config.get("measure") or "count"
    if measure == "count":
        aggregate = func.count()
    else:
        field = resource.fields.by_name.get(config.get("measure_field") or "")
        if field is None or field.kind != "number":
            raise ValidationError("A sum or an average needs a number field.",
                                  details={"field": "measure_field"})
        aggregate = (func.sum if measure == "sum" else func.avg)(field.column)

    bucket = func.date_trunc(granularity, func.timezone("UTC", column)).label("bucket")
    statement = select(bucket, aggregate.label("value")).select_from(resource.model)
    deleted = getattr(resource.model, "deleted_at", None)
    if deleted is not None:
        statement = statement.where(deleted.is_(None))
    statement = apply_filters(statement, dict(config.get("filters") or {}), resource.fields)
    statement = statement.where(column >= start, column < end + step).group_by(bucket)

    found: dict[datetime, float] = {}
    for at, value in session.execute(statement):
        key = at.replace(tzinfo=timezone.utc) if at.tzinfo is None else at.astimezone(timezone.utc)
        found[key] = float(value or 0)
    out = []
    for index in range(points):
        at = start + step * index
        out.append({"at": at.isoformat(), "value": round(found.get(at, 0.0), 4)})
    return out


def catalogue(*, principal) -> dict[str, Any]:
    """The datasets a watch may name, with what each can be measured and dated by."""
    from src.services.records.explorer import resources

    principal.require(VIEW)
    datasets = []
    for resource in resources().values():
        if not principal.can(resource.permission):
            continue
        datasets.append({
            "key": resource.key,
            "label": resource.label,
            "default_date": _date_field(resource, None),
            "dates": [{"name": f.name, "label": f.title} for f in resource.fields.fields if f.kind == "datetime"],
            "numbers": [{"name": f.name, "label": f.title} for f in resource.fields.fields if f.kind == "number"],
            "filters": [
                {"name": f.name, "label": f.title, "kind": f.kind, "choices": list(f.choices)}
                for f in resource.fields.fields if f.filterable and f.kind in ("enum", "bool")
            ],
        })
    return {
        "datasets": datasets,
        "measures": list(MEASURES),
        "granularities": list(GRANULARITIES),
        "methods": list(METHODS),
        "sensitivities": [{"key": k, "threshold": v} for k, v in SENSITIVITY.items()],
        "directions": list(DIRECTIONS),
        "channels": list(CHANNELS),
        "can_manage": principal.can(MANAGE),
    }
