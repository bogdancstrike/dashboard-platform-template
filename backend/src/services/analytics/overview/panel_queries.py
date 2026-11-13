"""The aggregations behind the composite panels."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import Numeric, and_, cast, func, select

from src.services.analytics.overview.series import _POSTGRES_WEEKDAYS


def _top_customers(session, Customer, limit: int = 10) -> list[dict[str, Any]]:
    rows = session.execute(
        select(Customer.name, cast(Customer.lifetime_value, Numeric).label("value"))
        .where(Customer.deleted_at.is_(None), Customer.lifetime_value.isnot(None))
        .order_by(cast(Customer.lifetime_value, Numeric).desc())
        .limit(limit)
    ).all()
    return [{"name": str(row.name), "value": float(row.value or 0)} for row in rows]


def _fulfilment_funnel(session, Order, start: datetime, end: datetime) -> list[dict[str, Any]]:
    """Placed → paid → shipped → delivered, each a subset of the one before.

    Counted as *cumulative* stages rather than as current-status buckets: a
    delivered order is also one that was shipped, and a funnel whose stages do
    not nest is a bar chart drawn in a suggestive shape.
    """
    window = and_(Order.placed_at >= start, Order.placed_at < end)
    stages = [
        ("Placed", None),
        ("Paid", Order.payment_status == "PAID"),
        ("Shipped", and_(Order.payment_status == "PAID",
                         Order.fulfilment_status.in_(("SHIPPED", "DELIVERED")))),
        ("Delivered", and_(Order.payment_status == "PAID",
                           Order.fulfilment_status == "DELIVERED")),
    ]
    out = []
    for label, clause in stages:
        statement = select(func.count()).select_from(Order).where(window, Order.deleted_at.is_(None))
        if clause is not None:
            statement = statement.where(clause)
        out.append({"name": label, "value": int(session.scalar(statement) or 0)})
    return out


def _sla_gauge(session, Ticket, start: datetime, end: datetime) -> list[dict[str, Any]]:
    window = and_(Ticket.created_at >= start, Ticket.created_at < end, Ticket.deleted_at.is_(None))
    total = int(session.scalar(select(func.count()).select_from(Ticket).where(window)) or 0)
    breached = int(
        session.scalar(
            select(func.count()).select_from(Ticket).where(window, Ticket.sla_breached.is_(True))
        )
        or 0
    )
    # No observations is an empty panel, not evidence of perfect compliance.
    if not total:
        return []
    within = round(100 * (total - breached) / total, 1)
    return [{"name": f"of {total:,} tickets", "value": within}]


def _support_load(session, Ticket, start: datetime, end: datetime) -> list[dict[str, Any]]:
    """Tickets by weekday and hour — the two dimensions of "when are we busy".

    `dow`/`hour` come from PostgreSQL rather than from Python so the whole
    thing is one pass over the index rather than a fetch of every row.
    """
    weekday = func.extract("dow", Ticket.created_at).label("weekday")
    hour = func.extract("hour", Ticket.created_at).label("hour")
    rows = session.execute(
        select(weekday, hour, func.count().label("value"))
        .where(and_(Ticket.created_at >= start, Ticket.created_at < end))
        .group_by(weekday, hour)
    ).all()
    return [
        {
            "name": _POSTGRES_WEEKDAYS[int(row.weekday) % 7],
            "group": f"{int(row.hour):02d}",
            "value": int(row.value),
        }
        for row in rows
    ]


def _budget_vs_progress(session, Project) -> list[dict[str, Any]]:
    rows = session.execute(
        select(
            Project.name,
            Project.health,
            cast(Project.budget, Numeric).label("budget"),
            cast(Project.spent, Numeric).label("spent"),
            Project.progress,
        ).where(
            Project.deleted_at.is_(None),
            Project.budget.isnot(None),
            cast(Project.budget, Numeric) > 0,
        )
    ).all()
    return [
        {
            "name": str(row.name),
            "group": str(row.health or "—"),
            # x is budget burn, y is work done. On the diagonal is healthy;
            # below it is overspend, above it is underspend.
            "x": round(100 * float(row.spent or 0) / float(row.budget), 1),
            "y": float(row.progress or 0),
            "value": float(row.budget),
        }
        for row in rows
    ]


def _device_health(session, Device) -> list[dict[str, Any]]:
    rows = session.execute(
        select(Device.kind, Device.status, func.count().label("value"))
        .where(Device.deleted_at.is_(None))
        .group_by(Device.kind, Device.status)
    ).all()
    return [
        {"name": str(row.kind or "—"), "group": str(row.status or "—"), "value": int(row.value)}
        for row in rows
    ]
