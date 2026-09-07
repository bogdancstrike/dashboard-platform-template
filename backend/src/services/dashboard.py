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

Aggregates run in PostgreSQL; the browser receives chart-sized results rather
than downloading whole datasets to count them. Snapshot panels explicitly say
so because their current state does not represent the selected historical range.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import Numeric, and_, case, cast, func, or_, select

from src.core import vocabulary
from src.core.clock import iso, now, previous_period, resolve_range

#: The week as a reader reads it, Monday first. The heatmap's vertical axis.
WEEKDAYS: tuple[str, ...] = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")

#: The same names indexed the way PostgreSQL's `extract('dow')` counts, which
#: starts on Sunday. Kept beside `WEEKDAYS` rather than inline at the call
#: site, because two orderings of the same seven strings a hundred lines apart
#: is how a chart ends up one day out.
_POSTGRES_WEEKDAYS: tuple[str, ...] = ("Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat")

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


def _grouped_series(
    session, column, group_column, start: datetime, end: datetime, *clauses, limit: int = 5
):
    """A time series split by a second dimension — the stacked-bar shape.

    Two GROUP BYs rather than one query per group: "orders by channel over
    twelve weeks" is one statement, and asking it five times because the chart
    has five stacks is five times the work for the same answer.

    The groups are capped and the tail folded into `Other`, because a stack of
    twenty is a colour wheel, and because the palette only has ten colours that
    are distinguishable from one another.
    """
    grain = _bucket(start, end)
    bucket = func.date_trunc(grain, column)
    statement = (
        select(bucket.label("bucket"), group_column.label("group"), func.count().label("value"))
        .where(and_(column >= start, column < end))
        .group_by(bucket, group_column)
        .order_by(bucket)
    )
    for clause in clauses:
        statement = statement.where(clause)

    rows = session.execute(statement).all()
    totals: dict[str, float] = {}
    for row in rows:
        name = str(row.group or "—")
        totals[name] = totals.get(name, 0) + float(row.value or 0)

    kept = [name for name, _ in sorted(totals.items(), key=lambda item: -item[1])[:limit]]
    # Fold the tail per bucket so chart, table and CSV contain the same cells.
    cells: dict[tuple[str, str], float] = {}
    for row in rows:
        name = str(row.group or "—")
        key = (iso(row.bucket), name if name in kept else "Other")
        cells[key] = cells.get(key, 0) + float(row.value or 0)
    series = [{"bucket": bucket, "group": group, "value": value}
              for (bucket, group), value in cells.items()]
    groups = [*kept, "Other"] if len(totals) > len(kept) else kept
    return series, groups


def charts(session, start: datetime, end: datetime) -> dict[str, Any]:
    """Every panel the dashboard draws, aggregated in PostgreSQL.

    The vocabulary is deliberately wide — line, area, bar, horizontal bar,
    stacked bar, pie, funnel, gauge, scatter and heatmap — because this is a
    template, and a template that only demonstrates a bar chart teaches people
    to reach for a bar chart. Each kind is here because a *question* wanted it:
    a funnel because fulfilment is a sequence with drop-off, a heatmap because
    "when does support get busy" is two dimensions, a scatter because budget
    against progress is a correlation and a bar chart of either alone hides it.
    """
    from src.models.business import Customer, Device, Order, Project, Task, Ticket
    from src.models.identity import Region

    booked = ~Order.status.in_(("CANCELLED", "REFUNDED"))

    revenue_series = _series(
        session, Order.placed_at, func.sum(cast(Order.total, Numeric)), start, end, booked
    )
    order_series = _series(session, Order.placed_at, func.count(), start, end)
    ticket_series = _series(session, Ticket.created_at, func.count(), start, end)
    resolved_series = _series(
        session, Ticket.resolved_at, func.count(), start, end,
        Ticket.deleted_at.is_(None),
    )

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

    channel_series, channels = _grouped_series(
        session, Order.placed_at, Order.channel, start, end, booked
    )
    portfolio = _budget_vs_progress(session, Project)

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
        # Raised against resolved on one axis: the gap *is* the backlog, and
        # two separate charts leave the reader subtracting by eye.
        "ticket_flow": {
            "kind": "multi-line",
            "title": "Tickets raised against resolved",
            "groups": ["Raised", "Resolved"],
            "series": [
                *({**point, "group": "Raised"} for point in ticket_series),
                *({**point, "group": "Resolved"} for point in resolved_series),
            ],
        },
        "orders_by_channel": {
            "kind": "stacked-bar",
            "title": "Orders by channel",
            "groups": channels,
            "series": channel_series,
        },
        "tickets_by_category": {
            "kind": "bar",
            "title": "Tickets by category",
            "description": "Current open tickets · all dates",
            "series": grouped(
                Ticket.category, None, ~Ticket.status.in_(("RESOLVED", "CLOSED"))
            ),
        },
        "tasks_by_status": {
            "kind": "bar",
            "title": "Tasks by status",
            "description": "Current task state · all dates",
            "series": grouped(Task.status, None, Task.deleted_at.is_(None)),
        },
        "projects_by_health": {
            "kind": "pie",
            "title": "Projects by health",
            "description": "Current active projects · all dates",
            "series": grouped(Project.health, None, Project.status == "ACTIVE", Project.deleted_at.is_(None)),
        },
        "revenue_by_region": {
            "kind": "bar",
            "title": "Revenue by region",
            "series": revenue_by_region,
        },
        "top_customers": {
            # Horizontal, because these are names: a vertical bar chart of ten
            # company names is ten tilted labels nobody reads.
            "kind": "hbar",
            "title": "Largest accounts by lifetime value",
            "description": "Lifetime value · current accounts",
            "unit": "currency",
            "series": _top_customers(session, Customer),
        },
        "fulfilment_funnel": {
            # A sequence with drop-off is a funnel; drawn as bars it is four
            # numbers the reader has to divide.
            "kind": "funnel",
            "title": "From order to delivery",
            "series": _fulfilment_funnel(session, Order, start, end),
        },
        "sla_gauge": {
            "kind": "gauge",
            "title": "Tickets without an SLA breach",
            "description": "Tickets created in the selected period; includes unanswered tickets",
            "unit": "percent",
            "series": _sla_gauge(session, Ticket, start, end),
        },
        "support_load": {
            # Two dimensions — day and hour — so a heatmap. A line chart of
            # this averages Tuesday morning with Sunday night.
            #
            # The axes are declared rather than assumed by the renderer: a
            # heatmap is a two-dimensional count, and only whoever asked the
            # question knows that these particular rows read Mon→Sun and 00→23
            # rather than in whatever order the GROUP BY returned them.
            "kind": "heatmap",
            "title": "When support gets busy",
            "description": "Tickets created in the selected period · UTC weekday and hour",
            "categories": list(WEEKDAYS),
            "groups": [f"{hour:02d}" for hour in range(24)],
            "series": _support_load(session, Ticket, start, end),
        },
        "budget_vs_progress": {
            # A correlation. Budget spent and work done are each unremarkable
            # alone; the projects far from the diagonal are the finding.
            "kind": "scatter",
            "title": "Budget spent against work done",
            "description": "Current projects · bubble size represents budget",
            # What the two axes mean, said here rather than known by the
            # renderer — which draws any two numbers against each other.
            "axes": {"x": "Budget spent", "y": "Work done", "format": "percent"},
            "series": portfolio,
        },
        "device_health": {
            "kind": "stacked-hbar",
            "title": "Fleet state by kind",
            "description": "Current fleet state · all dates",
            "groups": list(vocabulary.DEVICE_STATUS),
            "series": _device_health(session, Device),
        },
        "support_profile": {
            "kind": "radar",
            "title": "Support demand by priority",
            "description": "Tickets created in the selected period",
            "series": grouped(Ticket.priority, None, Ticket.created_at >= start,
                              Ticket.created_at < end, Ticket.deleted_at.is_(None)),
        },
        "portfolio_budget": {
            "kind": "treemap",
            "title": "Where the project budget sits",
            "description": "Current portfolio · area represents budget; grouped by health",
            "unit": "currency",
            "series": portfolio,
        },
    }


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
