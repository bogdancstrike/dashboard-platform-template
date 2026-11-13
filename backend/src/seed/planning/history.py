"""Seed data for planning: _Maker, _recount, _history."""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy import func, select

from src.seed.planning.templates import _day


class _Maker:
    """Creates tasks with the next TSK reference, one flush each."""

    def __init__(self, session):
        from src.services.records.explorer import resource_for
        from src.services.records.writes import _next_identifier

        self.session = session
        self.resource = resource_for("task")
        self._next = _next_identifier
        self.made = 0

    def __call__(self, **values):
        from src.models.business import Task

        row = Task(reference=self._next(self.session, self.resource), **values)
        row.metadata_json = {"source": "planning-seed"}
        self.session.add(row)
        self.session.flush()
        self.made += 1
        return row


def _recount(session, projects) -> None:
    """Keep the projects' denormalised task counters true (`--check` asserts them)."""
    from src.models.business import Task

    for project in projects:
        project.task_count = session.scalar(
            select(func.count()).select_from(Task).where(Task.project_id == project.id)
        ) or 0
        project.open_task_count = session.scalar(
            select(func.count()).select_from(Task).where(
                Task.project_id == project.id, Task.status.not_in(("DONE", "CANCELLED"))
            )
        ) or 0
    session.flush()


def _history(session, sprint, scope, done_rows, rng, upto: date | None = None) -> int:
    """One snapshot per day: work trickles to done, with a flat start and a late rush."""
    from src.models.planning import SprintSnapshot

    finished = {row.id: _day(row.completed_at) for row in done_rows}
    last = min(sprint.end_date, upto) if upto else sprint.end_date
    written = 0
    day = sprint.start_date
    while day <= last:
        # Work added mid-sprint joins the scope on the day it was added.
        present = [row for row in scope if not row.sprint_added_at or _day(row.sprint_added_at) <= day]
        total = sum(float(row.story_points) for row in present)
        done = [row for row in done_rows if row in present and finished.get(row.id) and finished[row.id] <= day]
        done_points = sum(float(row.story_points) for row in done)
        session.add(SprintSnapshot(
            sprint_id=sprint.id, day=day, total_points=Decimal(str(total)),
            done_points=Decimal(str(done_points)), remaining_points=Decimal(str(total - done_points)),
            total_tasks=len(present), done_tasks=len(done),
        ))
        written += 1
        day += timedelta(days=1)
    session.flush()
    return written
