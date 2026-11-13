"""The overview dashboard (§2, §44, §66): KPIs, chart panels, alerts and recent activity for a period.
See docs/architecture/backend/overview.md."""

from __future__ import annotations

from src.core.facade import lazy

__getattr__, __dir__, __all__ = lazy(__name__, {
    "measures": ("PERIODS", "_change", "_kpi", "_entity_of", "_live", "_count", "_sum", "_open_at"),
    "series": ("WEEKDAYS", "_POSTGRES_WEEKDAYS", "_bucket", "_series", "_grouped_series"),
    "headline": ("kpis",),
    "chart_panels": ("charts",),
    "panel_queries": (
        "_top_customers", "_fulfilment_funnel", "_sla_gauge", "_support_load",
        "_budget_vs_progress", "_device_health",
    ),
    "alerting": ("alerts",),
    "feed": ("recent_activity",),
    "payload": ("SUMMARISES", "summary", "_summary"),
})
