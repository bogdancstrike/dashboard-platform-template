"""A person's own page, and a colleague's (§40, §41).

Until this existed there was nowhere in the platform a reader could look at
*themselves*. Their access was visible only to an administrator opening
`/admin/users/:id`, which is the page the person asking cannot open — so the
commonest support question in any platform of this shape, "why can I not
export?", had no self-service answer at all.

Four decisions carry this module.

**Your own page needs no permission.** `/settings/security` already works that
way (§41) and for the same reason: a page about you that has to be granted is a
page most people never see, and its whole value is that the person who needs it
can reach it. Every query here is scoped to one user id, and which id is
decided by the server from the token — never from the request.

**Somebody else's page shows what the directory shows, plus their work.** Name,
role, organisation, department, job title: `/admin/users` is readable by every
persona, so none of that is a new disclosure. Contact details and the
permission breakdown need `users.view`, which is the permission that already
governs them. Their *activity trail* is the audit log by another name and needs
`audit.view` — a per-person list of everything somebody did is exactly what
that permission exists to gate.

**The access explanation is the point of the overview.** Role plus groups, the
effective set, and the part that came from a group rather than the role —
computed by `users.access_of`, the same function the administrator's page uses,
so the two can never disagree about what somebody may do.

**The analytics are aggregates and are cached like the other aggregates.** Four
`GROUP BY`s over the whole dataset per profile, invalidated by the writes that
make them stale rather than by a timer — see `core/cache`. Keyed on the person,
because a profile is a question about one of them.
"""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from sqlalchemy import Integer, case, func, select
from sqlalchemy import cast as sql_cast

from src.core import cache
from src.core.clock import iso, now
from src.core.errors import ValidationError
from src.core.naming import initials
from src.services import users as directory_admin

#: How far back the throughput chart looks, in weeks.
#:
#: Twelve, because a quarter is the window somebody actually reasons about —
#: "am I getting through more than I was" — and fifty-two weeks of bars at this
#: width is a texture rather than a trend.
THROUGHPUT_WEEKS = 12

#: How far back the day/hour heatmap looks.
#:
#: Ninety days over a seven-by-twenty-four grid gives each cell a chance of
#: holding something. A week of data in the same grid is one row of dots and
#: 161 empty cells, which reads as a broken chart rather than a quiet week.
HEATMAP_DAYS = 90

#: Record types on the "what they work on" chart.
TOUCH_LIMIT = 8

#: Entries on the profile's own activity strip. It is a summary; the Activity
#: tab is where the whole trail lives.
RECENT_ACTIVITY = 8


def profile(session, who: Any, *, principal) -> dict[str, Any]:
    """One person's page. `who` is a user id, or empty for the caller."""
    person = _person(session, who, principal=principal)
    mine = person.id == principal.user_id

    # What this reader may be told about this person. Computed once and
    # published, so the page can *say* what it is not showing rather than
    # leaving a section mysteriously empty (§76).
    may_see_contact = mine or principal.can(directory_admin.VIEW_PERMISSION)
    may_see_access = mine or principal.can(directory_admin.VIEW_PERMISSION)
    may_see_activity = mine or principal.can("audit.view")

    body: dict[str, Any] = {
        "is_me": mine,
        "user": {
            "id": str(person.id),
            "full_name": person.full_name,
            "initials": initials(person.full_name),
            "username": person.username,
            "avatar_url": person.avatar_url,
            "job_title": person.job_title or "",
            "status": person.status,
            # Contact details are the half a directory withholds, so they are
            # absent rather than blank when the reader may not have them.
            **({"email": person.email, "phone": person.phone or ""} if may_see_contact else {}),
        },
        "role": {
            "code": person.role.code if person.role else None,
            "name": person.role.name if person.role else "",
            "color": person.role.color if person.role else "",
            "description": person.role.description if person.role else "",
        },
        "organization": _named(person.organization),
        "department": _named(person.department),
        # No `team` relationship on `User` — the column exists and the mapping
        # does not, so the name is looked up rather than navigated. Not worth a
        # relationship for one label on one page.
        "team": _team(session, person),
        "manager": _named(person.manager),
        "joined_at": iso(person.created_at),
        "last_login_at": iso(person.last_login_at),
        "login_count": person.login_count if may_see_contact else None,
        "locale": person.locale,
        "timezone": person.timezone,
        "mfa_enabled": bool(person.mfa_enabled),
        "visibility": {
            "contact": may_see_contact,
            "access": may_see_access,
            "activity": may_see_activity,
        },
        # Why the reader can do what they can, from the same function the
        # administrator's page uses.
        "groups": directory_admin.groups_of(person) if may_see_access else [],
        "access": directory_admin.access_of(person) if may_see_access else None,
        **_analytics(session, person),
    }
    if may_see_activity:
        body["recent_activity"] = _recent(session, person)
    return body


def _person(session, who: Any, *, principal):
    """The person a request is about — the caller unless it names somebody."""
    identifier = str(who or "").strip()
    if not identifier or identifier == "me":
        if principal.user_id is None:
            raise ValidationError("This request has no signed-in user.")
        return directory_admin.load_person(session, principal.user_id)
    return directory_admin.load_person(session, identifier)


def _team(session, person) -> dict[str, Any] | None:
    from src.models.identity import Team

    if person.team_id is None:
        return None
    return _named(session.get(Team, person.team_id))


def _named(row) -> dict[str, Any] | None:
    """An organization, a department, a team — or a *person*.

    All four are drawn the same way on the profile, and three of them carry a
    `name`. A `User` does not: people are named by `full_name`, because a
    platform with both would eventually disagree with itself about which was
    the display name. `manager` went through here anyway and raised
    `AttributeError` — a 500 on the page a person opens to look at themselves,
    and on every colleague's page too.
    """
    if row is None:
        return None
    name = getattr(row, "name", None) or getattr(row, "full_name", None) or ""
    return {"id": str(row.id), "name": name}


# ── the numbers ──────────────────────────────────────────────────────────


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


def _heatmap(session, person) -> list[dict[str, Any]]:
    """When this person works, as weekday × hour.

    Every cell is present, including the empty ones: a heatmap drawn only where
    there is data has no grid, and the reader cannot tell "nothing on Sunday"
    from "Sunday is not shown".
    """
    from src.models.platform import ActivityEntry

    start = now() - timedelta(days=HEATMAP_DAYS)
    # `dow` is 0=Sunday in PostgreSQL; shifted so Monday is 0, which is how
    # every calendar in this product is drawn.
    weekday = sql_cast(
        case(
            (func.extract("dow", ActivityEntry.occurred_at) == 0, 6),
            else_=func.extract("dow", ActivityEntry.occurred_at) - 1,
        ),
        Integer,
    )
    hour = sql_cast(func.extract("hour", ActivityEntry.occurred_at), Integer)

    rows = session.execute(
        select(weekday.label("day"), hour.label("hour"), func.count().label("value"))
        .where(ActivityEntry.actor_id == person.id, ActivityEntry.occurred_at >= start)
        .group_by(weekday, hour)
    ).all()
    found = {(int(row.day), int(row.hour)): int(row.value or 0) for row in rows}

    return [
        {"day": day, "hour": hour, "value": found.get((day, hour), 0)}
        for day in range(7)
        for hour in range(24)
    ]


def _touches(session, person) -> list[dict[str, Any]]:
    """Which record types this person works on, most first."""
    from src.models.platform import ActivityEntry

    rows = session.execute(
        select(ActivityEntry.resource_type.label("name"), func.count().label("value"))
        .where(ActivityEntry.actor_id == person.id, ActivityEntry.resource_type.isnot(None))
        .group_by(ActivityEntry.resource_type)
        .order_by(func.count().desc())
        .limit(TOUCH_LIMIT)
    ).all()
    return [{"name": str(row.name), "value": int(row.value or 0)} for row in rows]


def _recent(session, person) -> list[dict[str, Any]]:
    """The last few things they did, for the overview.

    The whole trail is the Activity tab, which is the activity feed filtered by
    actor — the same endpoint `/activity` uses, so a person's page and the
    platform-wide feed cannot disagree about what happened.
    """
    from src.models.platform import ActivityEntry

    rows = session.scalars(
        select(ActivityEntry)
        .where(ActivityEntry.actor_id == person.id)
        .order_by(ActivityEntry.occurred_at.desc())
        .limit(RECENT_ACTIVITY)
    ).all()
    return [
        {
            "id": str(row.id),
            "action": row.action,
            "kind": row.kind,
            "resource_type": row.resource_type,
            "resource_id": row.resource_id,
            "resource_label": row.resource_label,
            "summary": row.summary,
            "occurred_at": iso(row.occurred_at),
        }
        for row in rows
    ]
