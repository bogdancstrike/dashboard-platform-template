"""Panels about support tickets."""

from __future__ import annotations

from typing import Any

from sqlalchemy import func

from src.models.business import Ticket
from src.services.analytics.overview.panel_queries import _sla_gauge, _support_load
from src.services.analytics.overview.series import WEEKDAYS
from src.services.analytics.overview.window import Window


def tickets_over_time(w: Window) -> dict[str, Any]:
    return {"kind": "line", "title": "Tickets raised", "series": w.ticket_series}


def ticket_flow(w: Window) -> dict[str, Any]:
    # Raised against resolved on one axis: the gap *is* the backlog.
    resolved = w.series(Ticket.resolved_at, func.count())
    return {"kind": "multi-line", "title": "Tickets raised against resolved",
            "groups": ["Raised", "Resolved"],
            "series": [*({**point, "group": "Raised"} for point in w.ticket_series),
                       *({**point, "group": "Resolved"} for point in resolved)]}


def tickets_by_category(w: Window) -> dict[str, Any]:
    return {"kind": "bar", "title": "Tickets by category",
            "description": "Current open tickets · all dates",
            "series": w.grouped(Ticket.category, None, ~Ticket.status.in_(("RESOLVED", "CLOSED")))}


def sla_gauge(w: Window) -> dict[str, Any]:
    return {"kind": "gauge", "title": "Tickets without an SLA breach",
            "description": "Tickets created in the selected period; includes unanswered tickets",
            "unit": "percent", "series": _sla_gauge(w.session, Ticket, w.start, w.end)}


def support_load(w: Window) -> dict[str, Any]:
    # Day × hour, so a heatmap; the axes are declared, not left to GROUP BY order.
    return {"kind": "heatmap", "title": "When support gets busy",
            "description": "Tickets created in the selected period · UTC weekday and hour",
            "categories": list(WEEKDAYS), "groups": [f"{hour:02d}" for hour in range(24)],
            "series": _support_load(w.session, Ticket, w.start, w.end)}


def support_profile(w: Window) -> dict[str, Any]:
    return {"kind": "radar", "title": "Support demand by priority",
            "description": "Tickets created in the selected period",
            "series": w.grouped(Ticket.priority, None, Ticket.created_at >= w.start,
                                Ticket.created_at < w.end)}
