"""A freshly seeded dataset is *current*: every window a page opens on has data.

Every date the generator writes is an offset from `world.anchor`, which is the
moment of generation — so a seed run today has orders this week, a calendar
with something on it today, work that is overdue and work that is coming up.
These assert exactly that, for the windows the pages default to (today, 7, 30
and 90 days), because a dashboard that says "nothing in this period" on a
fresh install looks broken however correct the query is.

What they cannot fix is *age*: a database seeded in September and opened in
November is two months stale. The cure for that is reseeding (`make reseed`),
not a different generator — see the report that added these.
"""

from __future__ import annotations

from tests.seed_support import (  # noqa: F401
    scratch_database,
    world,
)

from datetime import date, datetime, timedelta

import pytest

from src.seed import runner
from src.seed.world import SCALES

SEED = 4242


@pytest.fixture(scope="module")
def world():
    return runner.generate(scale=SCALES["small"], seed=SEED)


def _day(value) -> date | None:
    if value is None:
        return None
    return value.date() if isinstance(value, datetime) else value


def _within(rows, field: str, anchor: datetime, days: int) -> int:
    since = anchor - timedelta(days=days)
    return sum(1 for row in rows if (at := getattr(row, field, None)) is not None and since <= at <= anchor)


@pytest.mark.parametrize(
    ("collection", "field"),
    [
        ("orders", "created_at"),
        ("tickets", "created_at"),
        ("activity_entries", "created_at"),
        ("audit_logs", "created_at"),
        ("notifications", "created_at"),
        ("email_messages", "created_at"),
    ],
)
def test_every_default_window_has_rows(world, collection, field):
    rows = getattr(world, collection)
    for days in (7, 30, 90):
        assert _within(rows, field, world.anchor, days) > 0, f"{collection}: nothing in the last {days} days"


def test_the_calendar_has_something_today_and_this_week(world):
    today = world.anchor.date()
    starts = [_day(event.starts_at) for event in world.calendar_events]
    assert today in starts
    assert any(today < day <= today + timedelta(days=7) for day in starts if day)


def test_some_work_is_overdue_and_some_is_coming_up(world):
    today = world.anchor.date()
    open_tasks = [task for task in world.tasks if task.status not in ("DONE", "CANCELLED")]
    due = [_day(task.due_date) for task in open_tasks if task.due_date]
    assert any(day < today for day in due), "nothing overdue"
    assert any(today <= day <= today + timedelta(days=14) for day in due), "nothing due soon"


def test_nothing_is_dated_after_the_run_except_what_is_scheduled(world):
    """Created-at is the past; only due dates and events may be in the future."""
    for collection in ("orders", "tickets", "activity_entries", "audit_logs", "notifications", "login_events"):
        latest = max(row.created_at for row in getattr(world, collection))
        assert latest <= world.anchor + timedelta(seconds=1), collection


def test_the_anchor_is_the_moment_of_generation():
    from src.core.clock import now

    before = now()
    generated = runner.generate(scale=SCALES["small"], seed=SEED)
    assert abs((generated.anchor - before).total_seconds()) < 120
