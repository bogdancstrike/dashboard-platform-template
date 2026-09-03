"""The overview dashboard (§2, §44, §66).

Three things come out of here, and they are deliberately computed together:

* **KPIs** with the same figure for the previous period beside them. A number
  with no comparison is a number nobody can act on — "312 open tickets" is only
  interesting once you know it was 289 last month.
* **Charts**, each carrying the rows it was drawn from, so the frontend can
  offer the same panel as a table without a second request (§30).
* **Alerts** — the operational exceptions worth interrupting somebody for, each
  with the link that leads to the records behind it (§66).

Every KPI names the list it drills into, with the filters already applied
(§44). A tile that shows a number and cannot tell you which rows it counted is
a tile that starts an investigation instead of ending one.

All of it is one pass over PostgreSQL. The dashboard is the most-loaded screen
in any platform of this shape, and a screen that issues thirty queries is a
screen that gets cached badly and then shows stale numbers.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import Numeric, and_, case, cast, func, or_, select

from src.core.clock import iso, now, previous_period, resolve_range

#: The named ranges the period picker offers.
PERIODS: tuple[tuple[str, str], ...] = (
    ("today", "Today"),
    ("yesterday", "Yesterday"),
    ("last_7_days", "Last 7 days"),
    ("last_30_days", "Last 30 days"),
    ("last_90_days", "Last 90 days"),
    ("current_month", "This month"),
    ("previous_month", "Last month"),
    ("current_year", "This year"),
    ("previous_year", "Last year"),
    ("custom", "Custom range"),
)


def _change(current: float, previous: float) -> dict[str, Any]:
    """Percentage movement, and whether the movement is up or down.

    `direction` is left to the caller: more revenue is good, more failed jobs is
    not, and a tile that colours every increase green is a tile that reads
    "record number of outages" as good news.
    """
    if previous in (0, None):
        percent = 100.0 if current else 0.0
    else:
        percent = (current - previous) / abs(previous) * 100.0
    return {
        "previous": round(previous, 2) if isinstance(previous, float) else previous,
        "change_percent": round(percent, 1),
        "trend": "up" if current > previous else "down" if current < previous else "flat",
    }


def _kpi(
    key: str,
    label: str,
    value: float,
    previous: float,
    *,
    icon: str,
    accent: str,
    link: str,
    hint: str = "",
    unit: str = "",
    #: "up_is_good" | "down_is_good" | "neutral" — how to colour the movement.
    polarity: str = "up_is_good",
) -> dict[str, Any]:
    return {
        "key": key,
        "label": label,
        "value": round(value, 2) if isinstance(value, float) else value,
        "unit": unit,
        "icon": icon,
        "accent": accent,
        "link": link,
        "hint": hint,
        "polarity": polarity,
        **_change(float(value or 0), float(previous or 0)),
    }


def _count(session, model, *clauses) -> int:
    stmt = select(func.count()).select_from(model)
    for clause in clauses:
        stmt = stmt.where(clause)
    return session.scalar(stmt) or 0


def _sum(session, column, *clauses) -> float:
    stmt = select(func.coalesce(func.sum(column), 0))
    for clause in clauses:
        stmt = stmt.where(clause)
    return float(session.scalar(stmt) or 0)


def _open_at(session, model, created, closed, moment: datetime, *clauses) -> int:
    """How many rows were *open at* a moment — not how many existed by then.

    The distinction is the whole comparison. Counting rows created before the
    previous period ended answers "how many tickets had ever been raised",
    which only ever goes up, and makes every backlog look like it exploded.
    What a reader wants is the backlog as it stood: opened before that moment
    and not yet closed by it.
    """
    return _count(
        session,
        model,
        created < moment,
        or_(closed.is_(None), closed >= moment),
        *clauses,
    )


# ── KPIs ─────────────────────────────────────────────────────────────────


def kpis(session, start: datetime, end: datetime) -> list[dict[str, Any]]:
    from src.models.business import Device, Order, Project, Task, Ticket
    from src.models.identity import User
    from src.models.platform import BackgroundJob

    prior_start, prior_end = previous_period(start, end)
    moment = now()

    def window(column, a, b):
        return and_(column >= a, column < b)

    # Users — a lifetime headline with the period's arrivals beside it.
    total_users = _count(session, User, User.deleted_at.is_(None))
    new_users = _count(session, User, window(User.created_at, start, end))
    prior_users = _count(session, User, window(User.created_at, prior_start, prior_end))
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
    open_tasks = _count(session, Task, unfinished, Task.deleted_at.is_(None))
    prior_tasks = _open_at(
        session, Task, Task.created_at, Task.completed_at, prior_end, Task.deleted_at.is_(None)
    )
    overdue = _count(session, Task, unfinished, Task.due_date < moment)
    # Overdue *as it stood then*: due before that moment and still not finished
    # by it. Comparing against "due before then" alone counts work that was
    # delivered on time as if it had been late.
    prior_overdue = _open_at(
        session, Task, Task.created_at, Task.completed_at, prior_end,
        Task.due_date < prior_end, Task.deleted_at.is_(None),
    )

    active_projects = _count(session, Project, Project.status == "ACTIVE", Project.deleted_at.is_(None))
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


# ── charts ───────────────────────────────────────────────────────────────


def _bucket(start: datetime, end: datetime) -> str:
    """Day, week or month, chosen so a chart has 7–40 points.

    Ninety daily points on a 600px chart is a solid block of ink; twelve is a
    trend somebody can read.
    """
    span = (end - start).days
    if span <= 45:
        return "day"
    if span <= 400:
        return "week"
    return "month"


def _series(session, column, value_column, start: datetime, end: datetime, *clauses):
    grain = _bucket(start, end)
    bucket = func.date_trunc(grain, column)
    stmt = select(bucket.label("bucket"), value_column.label("value")).where(
        and_(column >= start, column < end)
    )
    for clause in clauses:
        stmt = stmt.where(clause)
    stmt = stmt.group_by(bucket).order_by(bucket)
    return [
        {"bucket": iso(row.bucket), "value": float(row.value or 0)}
        for row in session.execute(stmt).all()
    ]


def charts(session, start: datetime, end: datetime) -> dict[str, Any]:
    from src.models.business import Order, Project, Task, Ticket
    from src.models.identity import Region

    booked = ~Order.status.in_(("CANCELLED", "REFUNDED"))

    revenue_series = _series(
        session, Order.placed_at, func.sum(cast(Order.total, Numeric)), start, end, booked
    )
    order_series = _series(session, Order.placed_at, func.count(), start, end)
    ticket_series = _series(session, Ticket.created_at, func.count(), start, end)

    def grouped(column, label_column=None, *clauses, limit: int = 12):
        target = label_column if label_column is not None else column
        stmt = select(target.label("name"), func.count().label("value"))
        for clause in clauses:
            stmt = stmt.where(clause)
        stmt = stmt.group_by(target).order_by(func.count().desc()).limit(limit)
        return [
            {"name": str(row.name or "—"), "value": int(row.value)}
            for row in session.execute(stmt).all()
        ]

    revenue_by_region = [
        {"name": str(row.name or "Unassigned"), "value": float(row.value or 0)}
        for row in session.execute(
            select(Region.name.label("name"), func.sum(cast(Order.total, Numeric)).label("value"))
            .join(Region, Region.id == Order.region_id, isouter=True)
            .where(and_(Order.placed_at >= start, Order.placed_at < end, booked))
            .group_by(Region.name)
            .order_by(func.sum(cast(Order.total, Numeric)).desc())
        ).all()
    ]

    return {
        "grain": _bucket(start, end),
        "revenue_over_time": {
            "kind": "area",
            "title": "Revenue over time",
            "series": revenue_series,
        },
        "orders_over_time": {
            "kind": "line",
            "title": "Orders placed",
            "series": order_series,
        },
        "tickets_over_time": {
            "kind": "line",
            "title": "Tickets raised",
            "series": ticket_series,
        },
        "tickets_by_category": {
            "kind": "bar",
            "title": "Tickets by category",
            "series": grouped(
                Ticket.category, None, ~Ticket.status.in_(("RESOLVED", "CLOSED"))
            ),
        },
        "tasks_by_status": {
            "kind": "bar",
            "title": "Tasks by status",
            "series": grouped(Task.status, None, Task.deleted_at.is_(None)),
        },
        "projects_by_health": {
            "kind": "pie",
            "title": "Projects by health",
            "series": grouped(Project.health, None, Project.status == "ACTIVE"),
        },
        "revenue_by_region": {
            "kind": "bar",
            "title": "Revenue by region",
            "series": revenue_by_region,
        },
    }


# ── alerts (§66) ─────────────────────────────────────────────────────────


def alerts(session) -> list[dict[str, Any]]:
    """The operational exceptions, each with the list that explains it.

    An alert you cannot act on is noise, so every one of these carries a link
    to the records behind it. Only non-zero counts are returned — a dashboard
    that permanently shows "0 failed jobs" has trained everyone to ignore it.
    """
    from src.models.business import Device, Task, Ticket
    from src.models.identity import SecurityEvent
    from src.models.platform import BackgroundJob, ServiceHealth

    moment = now()
    out: list[dict[str, Any]] = []

    def add(key, severity, count, singular, plural, link, icon):
        """Both wordings, because a count of one is not a rare case here.

        "1 services are degraded" is the kind of detail that makes an operator
        trust the rest of the screen slightly less.
        """
        if not count:
            return
        template = singular if count == 1 else plural
        out.append({
            "key": key, "severity": severity, "count": int(count),
            "message": template.format(count=count), "link": link, "icon": icon,
        })

    add("failed_jobs", "CRITICAL",
        _count(session, BackgroundJob, BackgroundJob.status == "FAILED",
               BackgroundJob.created_at >= moment - timedelta(days=1)),
        "{count} background job failed in the last 24 hours",
        "{count} background jobs failed in the last 24 hours",
        "/admin/jobs?status=FAILED", "x-circle")

    add("degraded_services", "WARNING",
        _count(session, ServiceHealth, ServiceHealth.status.in_(("DEGRADED", "UNAVAILABLE"))),
        "{count} service is degraded or unavailable",
        "{count} services are degraded or unavailable",
        "/admin/health", "activity")

    add("overdue_tasks", "WARNING",
        _count(session, Task, ~Task.status.in_(("DONE", "CANCELLED")), Task.due_date < moment),
        "{count} task is past its due date",
        "{count} tasks are past their due date",
        "/tasks?overdue=true", "clock")

    add("sla_breaches", "CRITICAL",
        _count(session, Ticket, Ticket.sla_breached.is_(True),
               ~Ticket.status.in_(("RESOLVED", "CLOSED"))),
        "{count} open ticket has breached its SLA",
        "{count} open tickets have breached their SLA",
        "/tickets?sla_breached=true", "alert-triangle")

    add("devices_offline", "WARNING",
        _count(session, Device, Device.status == "OFFLINE"),
        "{count} device has stopped reporting",
        "{count} devices have stopped reporting",
        "/devices?status=OFFLINE", "cpu")

    add("security_events", "CRITICAL",
        _count(session, SecurityEvent, SecurityEvent.resolved.is_(False),
               SecurityEvent.severity == "CRITICAL"),
        "{count} unresolved critical security event",
        "{count} unresolved critical security events",
        "/settings/security", "shield")

    order = {"CRITICAL": 0, "WARNING": 1, "INFO": 2}
    out.sort(key=lambda alert: (order.get(alert["severity"], 3), -alert["count"]))
    return out


# ── activity feed (§35) ──────────────────────────────────────────────────


def recent_activity(session, limit: int = 12) -> list[dict[str, Any]]:
    from src.models.platform import ActivityEntry

    rows = session.scalars(
        select(ActivityEntry).order_by(ActivityEntry.occurred_at.desc()).limit(limit)
    ).all()
    return [
        {
            "id": str(row.id),
            "kind": row.kind,
            "action": row.action,
            "actor": row.actor_label,
            "summary": row.summary,
            "resource_type": row.resource_type,
            "resource_id": row.resource_id,
            "resource_label": row.resource_label,
            "occurred_at": iso(row.occurred_at),
        }
        for row in rows
    ]


# ── the whole payload ────────────────────────────────────────────────────


def summary(session, *, period: str, frm: str | None = None, to: str | None = None) -> dict[str, Any]:
    start, end = resolve_range(period, frm, to)
    prior_start, prior_end = previous_period(start, end)

    return {
        "period": {
            "key": period or "last_30_days",
            "from": iso(start),
            "to": iso(end),
            "previous_from": iso(prior_start),
            "previous_to": iso(prior_end),
            "options": [{"key": key, "label": label} for key, label in PERIODS],
        },
        "kpis": kpis(session, start, end),
        "charts": charts(session, start, end),
        "alerts": alerts(session),
        "activity": recent_activity(session),
        "generated_at": iso(now()),
    }
