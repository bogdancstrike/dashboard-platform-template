"""Their activity: the heatmap, recent touches and events."""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from sqlalchemy import Integer, case, func, select
from sqlalchemy import cast as sql_cast

from src.core.clock import iso, now

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
