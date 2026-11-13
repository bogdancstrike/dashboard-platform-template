"""Seed data for planning: populate."""

from __future__ import annotations

from sqlalchemy import func, select

from src.seed.planning.plan import _plan
from src.seed.planning.templates import _fill_ages, _fill_dates


def populate(session) -> dict[str, int]:
    """Plan the seeded work. Safe to run again."""
    from src.models.planning import Sprint
    from src.services.work import task_templates

    counts: dict[str, int] = {}
    if session.scalar(select(func.count()).select_from(Sprint)) == 0:
        counts.update(_plan(session))
    counts["start_dates"] = _fill_dates(session)
    counts["lane_ages"] = _fill_ages(session)
    task_templates.ensure_jobs(session)
    session.flush()
    return counts
