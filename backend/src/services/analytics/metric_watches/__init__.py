"""Metric watches (§22): watch a measure over time, flag spikes and drops, notify.
See docs/architecture/backend/metric-watches.md."""

from __future__ import annotations

from src.core.facade import lazy

__getattr__, __dir__, __all__ = lazy(__name__, {
    "detection": (
        "VIEW", "MANAGE", "MEASURES", "GRANULARITIES", "METHODS", "SENSITIVITY", "DIRECTIONS",
        "CHANNELS", "SEASON_CYCLES", "SEASON", "HISTORY", "MIN_BASELINE", "threshold_of",
        "baseline", "judge", "annotate",
    ),
    "measurement": ("_resource", "_date_field", "_floor", "series", "catalogue"),
    "validation": (
        "_config", "_dataset", "_filters", "_threshold_number", "_threshold_range",
        "_window_number", "_window_range", "_channels", "_recipient_ids", "_choice", "_SCHEMA",
        "validated", "_check_measure",
    ),
    "rows": ("_load", "_watch_dict", "_audit_state", "_anomaly_dict", "_maybe_catch_up"),
    "watches": ("listing", "get", "create", "update", "remove", "silence"),
    "evaluation": (
        "evaluate", "evaluate_now", "_hourly_job", "evaluate_all", "_recipients", "_describe",
        "_number", "_notify",
    ),
    "anomaly_reads": ("chart", "preview", "anomalies", "anomaly", "acknowledge"),
})
