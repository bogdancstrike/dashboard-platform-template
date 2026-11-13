"""The KPI row."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import and_

from src.core.clock import now, previous_period
from src.services.analytics.overview.measures import _count, _kpi, _open_at, _sum


def kpis(session, start: datetime, end: datetime) -> list[dict[str, Any]]:
    from src.models.business import Device, Order, Project, Task, Ticket
    from src.models.identity import User
    from src.models.platform import BackgroundJob

    prior_start, prior_end = previous_period(start, end)
    moment = now()

    def window(column, a, b):
        return and_(column >= a, column < b)

    # Users — a lifetime headline with the period's arrivals beside it.
    total_users = _count(session, User)
    new_users = _count(session, User, window(User.created_at, start, end))
    active_users = _count(session, User, User.last_login_at >= start, User.status == "ACTIVE")
    prior_active = _count(
        session, User, window(User.last_login_at, prior_start, prior_end), User.status == "ACTIVE"
    )

    # Revenue — cancelled and refunded orders are not revenue.
    booked = ~Order.status.in_(("CANCELLED", "REFUNDED"))
    revenue = _sum(session, Order.total, window(Order.placed_at, start, end), booked)
    prior_revenue = _sum(session, Order.total, window(Order.placed_at, prior_start, prior_end), booked)
    orders = _count(session, Order, window(Order.placed_at, start, end))
    prior_orders = _count(session, Order, window(Order.placed_at, prior_start, prior_end))

    open_tickets = _count(session, Ticket, ~Ticket.status.in_(("RESOLVED", "CLOSED")))
    prior_open = _open_at(session, Ticket, Ticket.created_at, Ticket.resolved_at, prior_end)
    breached = _count(session, Ticket, Ticket.sla_breached.is_(True), Ticket.created_at >= start)
    prior_breached = _count(
        session, Ticket, Ticket.sla_breached.is_(True),
        window(Ticket.created_at, prior_start, prior_end),
    )

    unfinished = ~Task.status.in_(("DONE", "CANCELLED"))
    open_tasks = _count(session, Task, unfinished)
    prior_tasks = _open_at(
        session, Task, Task.created_at, Task.completed_at, prior_end
    )
    overdue = _count(session, Task, unfinished, Task.due_date < moment)
    # Overdue *as it stood then*: due before that moment and still not finished
    # by it. Comparing against "due before then" alone counts work that was
    # delivered on time as if it had been late.
    prior_overdue = _open_at(
        session, Task, Task.created_at, Task.completed_at, prior_end,
        Task.due_date < prior_end,
    )

    active_projects = _count(session, Project, Project.status == "ACTIVE")
    prior_projects = _count(
        session, Project, Project.status == "ACTIVE", Project.created_at < prior_end
    )
    at_risk = _count(
        session, Project, Project.health.in_(("AT_RISK", "OFF_TRACK")), Project.status == "ACTIVE"
    )
    prior_at_risk = _count(
        session, Project, Project.health.in_(("AT_RISK", "OFF_TRACK")),
        Project.status == "ACTIVE", Project.created_at < prior_end,
    )

    offline = _count(session, Device, Device.status.in_(("OFFLINE", "DEGRADED")))
    prior_offline = _count(
        session, Device, Device.status.in_(("OFFLINE", "DEGRADED")), Device.created_at < prior_end
    )

    failed_jobs = _count(session, BackgroundJob, BackgroundJob.status == "FAILED",
                         BackgroundJob.created_at >= start)
    prior_failed = _count(session, BackgroundJob, BackgroundJob.status == "FAILED",
                          window(BackgroundJob.created_at, prior_start, prior_end))

    return [
        _kpi("revenue", "Revenue", revenue, prior_revenue, icon="euro", accent="success",
             link="/orders?placed_at_from={from}&placed_at_to={to}", unit="EUR",
             hint="Excludes cancelled and refunded orders"),
        _kpi("orders", "Orders placed", orders, prior_orders, icon="shopping-cart", accent="accent",
             link="/orders?placed_at_from={from}&placed_at_to={to}"),
        _kpi("active_users", "Active users", active_users, prior_active, icon="users", accent="info",
             link="/admin/users?status=ACTIVE", hint="Signed in during the period"),
        _kpi("total_users", "Total users", total_users, total_users - new_users, icon="user",
             accent="neutral", link="/admin/users"),
        _kpi("open_tickets", "Open tickets", open_tickets, prior_open, icon="life-buoy",
             accent="warning", link="/tickets?status__not_in=RESOLVED,CLOSED",
             polarity="down_is_good"),
        _kpi("sla_breached", "SLA breaches", breached, prior_breached, icon="alert-triangle",
             accent="danger", link="/tickets?sla_breached=true", polarity="down_is_good"),
        _kpi("open_tasks", "Open tasks", open_tasks, prior_tasks, icon="check-square",
             accent="accent", link="/tasks?status__not_in=DONE,CANCELLED", polarity="neutral"),
        _kpi("overdue_tasks", "Overdue tasks", overdue, prior_overdue, icon="clock",
             accent="danger", link="/tasks?overdue=true", polarity="down_is_good"),
        _kpi("active_projects", "Active projects", active_projects, prior_projects, icon="folder",
             accent="accent", link="/projects?status=ACTIVE"),
        _kpi("projects_at_risk", "Projects at risk", at_risk, prior_at_risk, icon="activity",
             accent="warning", link="/projects?health__in=AT_RISK,OFF_TRACK",
             polarity="down_is_good"),
        _kpi("devices_offline", "Devices degraded", offline, prior_offline, icon="cpu",
             accent="warning", link="/devices?status__in=OFFLINE,DEGRADED",
             polarity="down_is_good"),
        _kpi("failed_jobs", "Failed jobs", failed_jobs, prior_failed, icon="x-circle",
             accent="danger", link="/admin/jobs?status=FAILED", polarity="down_is_good"),
    ]
