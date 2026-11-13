"""Panels about orders and revenue."""

from __future__ import annotations

from typing import Any

from sqlalchemy import and_, func, select

from src.models.business import Customer, Order
from src.models.identity import Region
from src.services.analytics.overview.measures import _live
from src.services.analytics.overview.panel_queries import (
    _fulfilment_funnel,
    _top_customers,
)
from src.services.analytics.overview.series import _grouped_series
from src.services.analytics.overview.window import Window


def revenue_over_time(w: Window) -> dict[str, Any]:
    return {"kind": "area", "title": "Revenue over time",
            "series": w.series(Order.placed_at, w.revenue_total, w.booked)}


def orders_over_time(w: Window) -> dict[str, Any]:
    return {"kind": "line", "title": "Orders placed", "series": w.series(Order.placed_at, func.count())}


def orders_by_channel(w: Window) -> dict[str, Any]:
    series, channels = _grouped_series(w.session, Order.placed_at, Order.channel, w.start, w.end, w.booked)
    return {"kind": "stacked-bar", "title": "Orders by channel", "groups": channels, "series": series}


def revenue_by_channel(w: Window) -> dict[str, Any]:
    # Stacked *area*: the question is what the revenue line is made of, and the
    # answer wants a continuous total whose top edge is the revenue panel's line.
    series, channels = _grouped_series(w.session, Order.placed_at, Order.channel, w.start, w.end,
                                       w.booked, value_column=w.revenue_total)
    return {"kind": "stacked-area", "title": "What the revenue is made of",
            "description": "Booked orders in the selected period, by channel",
            "unit": "currency", "groups": channels, "series": series}


def revenue_by_region(w: Window) -> dict[str, Any]:
    rows = w.session.execute(
        select(Region.name.label("name"), w.revenue_total.label("value"))
        .join(Region, Region.id == Order.region_id, isouter=True)
        .where(and_(Order.placed_at >= w.start, Order.placed_at < w.end, w.booked, *_live(Order)))
        .group_by(Region.name)
        .order_by(w.revenue_total.desc())
    ).all()
    return {"kind": "bar", "title": "Revenue by region",
            "series": [{"name": str(row.name or "Unassigned"), "value": float(row.value or 0)}
                       for row in rows]}


def top_customers(w: Window) -> dict[str, Any]:
    # Horizontal, because these are names: ten tilted labels nobody reads.
    return {"kind": "hbar", "title": "Largest accounts by lifetime value",
            "description": "Lifetime value · current accounts", "unit": "currency",
            "series": _top_customers(w.session, Customer)}


def fulfilment_funnel(w: Window) -> dict[str, Any]:
    # A sequence with drop-off is a funnel; as bars it is four numbers to divide.
    return {"kind": "funnel", "title": "From order to delivery",
            "series": _fulfilment_funnel(w.session, Order, w.start, w.end)}
