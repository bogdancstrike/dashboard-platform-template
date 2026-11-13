"""Grouped aggregation over any declared dataset (§2, §28, §44, §71).
See docs/architecture/backend/analysis.md."""

from __future__ import annotations

from src.core.facade import lazy

__getattr__, __dir__, __all__ = lazy(__name__, {
    "vocabulary": (
        "DEFAULT_LIMIT", "MAX_LIMIT", "TIMESERIES_LIMIT", "GRANULARITIES", "PERIODS",
        "CALENDAR_PERIODS", "AGGREGATIONS", "DIMENSION_KINDS", "MEASURE_KINDS", "OTHER",
        "_AGGREGATION_WORDS", "Measure", "Dimension", "catalogue", "_default_date_field",
        "_period_label", "_calendar_days",
    ),
    "clauses": (
        "_dimensions", "_measures", "_measure_label", "_filter_args", "_limit", "_totals", "_over",
        "_number",
    ),
    "labelling": (
        "Window", "_grouped", "_remainder", "_key_of", "_label", "_describe", "known_period",
    ),
    "execution": ("run", "period_window", "_moment", "_within", "_period_field"),
})
