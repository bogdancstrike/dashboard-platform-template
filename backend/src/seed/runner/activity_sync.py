"""Repairs for the activity feed and the health history."""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from sqlalchemy import select

from src.core.clock import now
from src.seed.support import Rng


def sync_activity(session) -> dict[str, int]:
    """Give every organization a feed it can filter by any dataset (§34).

    The tenth repair, and the same class as `sync_flags`: the seed produced a
    state in which a shipped control demonstrates nothing. The history was
    drawn from one flat pool of every record, so a dataset was the subject of
    an event in proportion to how many rows it had — and once the feed is
    scoped to an organization, the administrator's own `project` filter matched
    nothing and `/activity` reported that nothing had happened.

    An *addition*, never an edit: existing entries are left exactly as they
    are, because an activity entry is a record of something that happened and
    rewriting one would be a lie about the past. What it adds is a real event
    over a real record — a status change on a project that exists, attributed
    to somebody in that organization — so nothing in the feed is invented
    beyond the fact that the seed should have written it in the first place.

    Idempotent: an organization that can already demonstrate a dataset is
    skipped.
    """
    from datetime import timedelta

    from src.core.audit import _activity_kind, _summarise
    from src.models.business import Customer, Order, Project, Task, Ticket
    from src.models.identity import User
    from src.models.platform import ActivityEntry

    # The datasets `/activity` offers as filters, and where each one's label
    # comes from — the same columns the seed uses, so a repaired entry is
    # indistinguishable from a seeded one.
    datasets: list[tuple[str, Any, str]] = [
        ("project", Project, "name"),
        ("task", Task, "title"),
        ("ticket", Ticket, "subject"),
        ("order", Order, "reference"),
        ("customer", Customer, "name"),
        ("user", User, "full_name"),
    ]

    organizations = sorted(
        {row for row in session.scalars(select(User.organization_id)).all() if row},
        key=str,
    )
    rng = Rng(20260101, now()).derive("sync-activity")
    added = 0

    for organization_id in organizations:
        people = session.scalars(
            select(User).where(User.organization_id == organization_id).limit(25)
        ).all()
        if not people:
            continue
        for resource_type, model, label_column in datasets:
            present = session.scalar(
                select(ActivityEntry.id)
                .where(ActivityEntry.organization_id == organization_id)
                .where(ActivityEntry.resource_type == resource_type)
                .limit(1)
            )
            if present:
                continue
            row = session.scalar(
                select(model).where(model.organization_id == organization_id).limit(1)
            )
            # Nothing to write about is not a gap: an organization with no
            # orders *should* have no order activity, and inventing one would
            # put a record in the feed that opens on a 404.
            if row is None:
                continue

            actor = rng.pick(list(people))
            label = str(getattr(row, label_column, "") or "")[:255]
            occurred = now() - timedelta(days=rng.integer(1, 30), hours=rng.integer(0, 23))
            session.add(
                ActivityEntry(
                    id=rng.uuid(),
                    occurred_at=occurred,
                    kind=_activity_kind("STATUS_CHANGE"),
                    action="STATUS_CHANGE",
                    actor_id=actor.id,
                    actor_label=actor.full_name,
                    resource_type=resource_type,
                    resource_id=str(row.id),
                    resource_label=label,
                    project_id=row.id if resource_type == "project" else None,
                    organization_id=organization_id,
                    summary=_summarise("STATUS_CHANGE", resource_type, label),
                    metadata_json={"changed": ["status"]},
                    created_at=occurred,
                )
            )
            added += 1

    return {"added": added, "organizations": len(organizations)}


def sync_health(session) -> dict[str, int]:
    """Give every monitored service a month of history to draw.

    The seventh repair, and an *edit* like `sync_org` — safe for the same
    reason: a health history is a recording, not a decision anybody made.

    The column was seeded with twenty-four hourly points, which is exactly one
    day, so `/admin/health`'s 7d and 30d windows drew empty charts on any
    database seeded before the page could ask for them. Rewritten rather than
    appended to, because a series stitched from two generators has a visible
    seam at the join and somebody would read it as an incident.
    """
    from src.models.platform import ServiceHealth
    from src.seed.operations import _health_series

    # Anchored on *now* rather than on the original seed's moment: a history
    # that ends a fortnight ago draws a chart with nothing in the window
    # anybody actually looks at.
    anchor = now()
    rng = Rng(int(anchor.timestamp() * 1000), anchor)
    rows = session.scalars(select(ServiceHealth)).all()
    extended = 0
    points = 0
    for row in rows:
        if len(row.history or []) >= 200 and not _history_is_stale(row.history, anchor):
            continue
        series = _health_series(rng.derive(f"health:{row.key}"), anchor)
        row.history = series
        extended += 1
        points = len(series)
    return {"extended": extended, "points": points}


#: How old the newest health reading may be before the history counts as stale.
HEALTH_STALE_AFTER = timedelta(days=1)


def _history_is_stale(history, anchor) -> bool:
    """Whether a history ends so long ago that the windows on screen are empty.

    A month of points is not enough on its own: a database seeded in September
    and opened in November has two hundred readings, all of them outside the
    8h, 1d and 7d windows — so `sync_health` used to call it "already has a
    month of history" and leave every chart on `/admin/health` blank.
    """
    from src.core.clock import parse

    readings = [parse(str(point.get("at") or "")) for point in history if isinstance(point, dict)]
    newest = max((at for at in readings if at is not None), default=None)
    return newest is None or anchor - newest > HEALTH_STALE_AFTER
