"""Every chart panel the dashboard draws: a table of panel builders.

The vocabulary is deliberately wide — line, area, bar, stacked, pie, funnel,
gauge, scatter, heatmap, radar, treemap — because each kind is here because a
*question* wanted it (see docs/architecture/backend/overview.md).
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Callable

from src.services.analytics.overview import sales_panels as sales
from src.services.analytics.overview import support_panels as support
from src.services.analytics.overview import work_panels as work
from src.services.analytics.overview.series import _bucket
from src.services.analytics.overview.window import Window

#: Panel key -> builder, in the order the payload lists them.
PANELS: dict[str, Callable[[Window], dict[str, Any]]] = {
    "revenue_over_time": sales.revenue_over_time,
    "orders_over_time": sales.orders_over_time,
    "tickets_over_time": support.tickets_over_time,
    "ticket_flow": support.ticket_flow,
    "orders_by_channel": sales.orders_by_channel,
    "revenue_by_channel": sales.revenue_by_channel,
    "tickets_by_category": support.tickets_by_category,
    "tasks_by_status": work.tasks_by_status,
    "projects_by_health": work.projects_by_health,
    "revenue_by_region": sales.revenue_by_region,
    "top_customers": sales.top_customers,
    "fulfilment_funnel": sales.fulfilment_funnel,
    "sla_gauge": support.sla_gauge,
    "support_load": support.support_load,
    "budget_vs_progress": work.budget_vs_progress,
    "device_health": work.device_health,
    "support_profile": support.support_profile,
    "portfolio_budget": work.portfolio_budget,
}


def charts(session, start: datetime, end: datetime) -> dict[str, Any]:
    """Every panel, aggregated in PostgreSQL, keyed as the dashboard reads them."""
    window = Window(session, start, end)
    return {"grain": _bucket(start, end), **{key: build(window) for key, build in PANELS.items()}}
