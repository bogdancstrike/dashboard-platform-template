"""The data explorer (§4, §44): declared datasets, querying them, export plans and insights."""

from __future__ import annotations

from src.core.facade import lazy

__getattr__, __dir__, __all__ = lazy(__name__, {
    "model": (
        "Metric", "Insight", "Writable", "Identity", "Resource", "_PICKABLE_TABLES",
        "references_of",
    ),
    "common": ("common_fields",),
    "registry": ("_resources", "resources", "resource_for"),
    "offering": ("catalogue",),
    "querying": (
        "EXPORT_PERMISSION", "run", "_base_statement", "_query_args", "_columns", "_serialize",
        "_json_value",
    ),
    "plans": ("Plan", "plan_for", "replan", "_plan", "statement_of", "statement_for"),
    "headlines": (
        "BREAKDOWN_LIMIT", "insights", "_cacheable", "_insights", "_metric", "_matches",
        "_breakdown",
    ),
    "trends": ("TREND_BUCKETS", "_column_of", "_trend"),
    "exporting": ("columns_of", "rows_of", "export"),
})
