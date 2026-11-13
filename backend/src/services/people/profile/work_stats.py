"""Their work in numbers: stats and weekly throughput."""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from sqlalchemy import func, select

from src.core import cache
from src.core.clock import iso, now
from src.services.people.profile.activity_trail import _heatmap, _touches

#: How far back the throughput chart looks, in weeks.
#:
#: Twelve, because a quarter is the window somebody actually reasons about —
#: "am I getting through more than I was" — and fifty-two weeks of bars at this
#: width is a texture rather than a trend.
THROUGHPUT_WEEKS = 12


def _analytics(session, person) -> dict[str, Any]:
    """Everything on the overview that costs a `GROUP BY`, in one cached block.

    One cache entry per person rather than one per chart: the four are read
    together, always, and four entries would be four round trips to Redis for
    one screen. `depends_on` names the datasets they are computed from, so a
    task this person completes shows up on their own page immediately — which
    is the case a timer gets wrong for exactly the reader who would notice.
    """
    return cache.aggregate(
        "profile:analytics",
        {"user": str(person.id)},
        depends_on=("task", "ticket", "project", "activity"),
        producer=lambda: {
            "stats": _stats(session, person),
            "throughput": _throughput(session, person),
            "heatmap": _heatmap(session, person),
            "touches": _touches(session, person),
        },
    )


def _stats(session, person) -> list[dict[str, Any]]:
    """The headline counts, as a list so the page renders what it is given."""
    from src.models.business import Project, Task, Ticket

    def count(model, *clauses) -> int:
        statement = select(func.count()).select_from(model)
        deleted = getattr(model, "deleted_at", None)
        if deleted is not None:
            statement = statement.where(deleted.is_(None))
        for clause in clauses:
            statement = statement.where(clause)
        return int(session.scalar(statement) or 0)

    open_tasks = count(
        Task, Task.assignee_id == person.id, ~Task.status.in_(("DONE", "CANCELLED"))
    )
    done_tasks = count(Task, Task.assignee_id == person.id, Task.status == "DONE")
    tickets = count(
        Ticket, Ticket.assignee_id == person.id, Ticket.status.in_(("RESOLVED", "CLOSED"))
    )
    open_tickets = count(
        Ticket, Ticket.assignee_id == person.id, ~Ticket.status.in_(("RESOLVED", "CLOSED"))
    )
    projects = count(Project, Project.owner_id == person.id, Project.status == "ACTIVE")

    return [
        {
            "key": "open_tasks",
            "label": "Tasks in hand",
            "value": open_tasks,
            "link": f"/tasks?f.assignee_id={person.id}",
            "hint": "Assigned and not finished",
        },
        {
            "key": "done_tasks",
            "label": "Tasks completed",
            "value": done_tasks,
            "link": f"/tasks?f.assignee_id={person.id}&f.status=DONE",
        },
        {
            "key": "open_tickets",
            "label": "Tickets in hand",
            "value": open_tickets,
            "link": f"/tickets?f.assignee_id={person.id}",
        },
        {
            "key": "resolved_tickets",
            "label": "Tickets resolved",
            "value": tickets,
            "link": f"/tickets?f.assignee_id={person.id}&f.status=RESOLVED",
        },
        {
            "key": "projects",
            "label": "Projects owned",
            "value": projects,
            "link": f"/projects?f.owner_id={person.id}",
            "hint": "Active, as owner",
        },
    ]


def _throughput(session, person) -> list[dict[str, Any]]:
    """Tasks completed per week — the shape of "am I getting through more".

    Every week in the window appears, including the empty ones. A chart that
    silently omits a quiet week draws a straight line through it and reports
    steady output where there was none.
    """
    from src.models.business import Task

    start = (now() - timedelta(weeks=THROUGHPUT_WEEKS)).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    bucket = func.date_trunc("week", Task.completed_at)
    rows = session.execute(
        select(bucket.label("bucket"), func.count().label("value"))
        .where(
            Task.assignee_id == person.id,
            Task.deleted_at.is_(None),
            Task.completed_at.isnot(None),
            Task.completed_at >= start,
        )
        .group_by(bucket)
        .order_by(bucket)
    ).all()
    found = {iso(row.bucket): int(row.value or 0) for row in rows}

    weeks: list[dict[str, Any]] = []
    # From the Monday of the first week in the window, so the buckets line up
    # with `date_trunc('week')` — which is Monday-based in PostgreSQL.
    cursor = start - timedelta(days=start.weekday())
    for _ in range(THROUGHPUT_WEEKS + 1):
        key = iso(cursor)
        weeks.append({"bucket": key, "value": found.get(key, 0)})
        cursor = cursor + timedelta(weeks=1)
    return weeks
