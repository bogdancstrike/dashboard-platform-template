"""A watch definition, checked against the dataset it names."""

from __future__ import annotations

from typing import Any

from src.core.cleaners import (
    choice,
    flag,
    json_object,
    number,
    one_of_listed,
    optional,
    text,
    whole,
    within,
)
from src.core.errors import ValidationError
from src.core.pagination import parse_uuid
from src.core.validation import Field, Schema
from src.services.analytics.metric_watches.detection import (
    CHANNELS,
    DIRECTIONS,
    GRANULARITIES,
    MEASURES,
    METHODS,
    SENSITIVITY,
)
from src.services.analytics.metric_watches.measurement import _date_field, _resource


def _config(row) -> dict[str, Any]:
    return {
        "dataset": row.dataset, "measure": row.measure, "measure_field": row.measure_field,
        "date_field": row.date_field, "filters": row.filters or {}, "granularity": row.granularity,
        "method": row.method, "sensitivity": row.sensitivity, "threshold": row.threshold,
        "direction": row.direction, "window": row.window,
    }


def _dataset(raw: Any, ctx) -> str:
    from src.services.records.explorer import resource_for

    return resource_for(raw, principal=ctx.principal).key


def _filters(raw: Any, ctx) -> dict[str, Any]:
    filters = json_object("filters must be an object.", details={"field": "filters"},
                          falsy_is_empty=False)(raw)
    return {str(k): v for k, v in filters.items() if v not in (None, "", [])}


_threshold_number = number("threshold must be a number.", details={"field": "threshold"})


_threshold_range = within(0.5, 10, "threshold must be between 0.5 and 10.",
                          details={"field": "threshold"})


_window_number = whole("window must be a whole number.", details={"field": "window"})


_window_range = within(3, 90, "window must be between 3 and 90 points.", details={"field": "window"})


def _channels(raw: Any, ctx) -> list[str]:
    channels = ["in_app"] if raw is None else raw
    if not isinstance(channels, list) or any(c not in CHANNELS for c in channels):
        raise ValidationError("channels are in_app and/or email.", details={"field": "channels"})
    return sorted(set(channels))


def _recipient_ids(raw: Any, ctx) -> list[str]:
    raw = raw or []
    if not isinstance(raw, list):
        raise ValidationError("recipient_ids must be a list.", details={"field": "recipient_ids"})
    return [str(parse_uuid(item, field="recipient_ids")) for item in raw]


def _choice(key: str, allowed, default: str) -> Field:
    allowed = tuple(allowed)
    return Field(key, choice(allowed, default=default, case=str.lower, error=one_of_listed(key)))


_SCHEMA = Schema(
    [
        Field("name", text(160, required="A watch needs a name.", details={"field": "name"})),
        Field("description", text(empty=None), sparse=True),
        Field("dataset", _dataset),
        _choice("measure", MEASURES, "count"),
        _choice("granularity", GRANULARITIES, "day"),
        _choice("method", METHODS, "zscore"),
        _choice("sensitivity", SENSITIVITY, "medium"),
        _choice("direction", DIRECTIONS, "both"),
        Field("measure_field", text(empty=None)),
        Field("date_field", text(empty=None)),
        Field("filters", _filters),
        Field("threshold", optional(lambda raw, ctx: _threshold_range(_threshold_number(raw))),
              sparse=True),
        Field("window", lambda raw, ctx: _window_range(_window_number(raw or 14))),
        Field("channels", _channels),
        Field("recipient_ids", _recipient_ids, sparse=True),
        Field("enabled", flag, sparse=True),
    ],
    not_object="The watch must be a JSON object.",
)


def validated(payload: Any, *, partial: bool = False, principal=None) -> dict[str, Any]:
    """A watch definition, checked against the dataset it names."""
    return _SCHEMA.validate(payload, partial=partial, principal=principal)


def _check_measure(config: dict[str, Any]) -> None:
    resource = _resource(config["dataset"])
    _date_field(resource, config.get("date_field"))
    if config.get("measure") in ("sum", "avg"):
        field = resource.fields.by_name.get(config.get("measure_field") or "")
        if field is None or field.kind != "number":
            raise ValidationError("A sum or an average needs a number field.",
                                  details={"field": "measure_field"})
    else:
        config["measure_field"] = None
    for key in (config.get("filters") or {}):
        name = str(key).rpartition("__")[0] if "__" in str(key) else str(key)
        for suffix in ("_min", "_max", "_from", "_to"):
            if name.endswith(suffix) and name[: -len(suffix)] in resource.fields.by_name:
                name = name[: -len(suffix)]
        if name != "q" and name not in resource.fields.by_name:
            raise ValidationError(f"{key} is not a field of {resource.label}.", details={"field": f"filters.{key}"})
