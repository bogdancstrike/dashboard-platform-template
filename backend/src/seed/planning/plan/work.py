"""Planning seed steps: the project's team, epics and work."""

from __future__ import annotations

from datetime import timedelta
from decimal import Decimal

from sqlalchemy import select

from src.models.business import Task
from src.models.identity import User
from src.seed.planning.templates import BUGS, POINTS, STORIES, _at


def _team_and_epics(s) -> None:
    """The project's people, and its epics."""
    session, rng, today, make, counts, admin, epic_cycle, projects, p_index, project, people, base, epics, extra, work, pool, scope = (
        s.session, s.rng, s.today, s.make, s.counts, s.admin, s.epic_cycle, s.projects, s.p_index, s.project, s.people, s.base, s.epics, s.extra, s.work, s.pool, s.scope,
    )
    members = session.scalars(
        select(User).where(User.organization_id == project.organization_id).order_by(User.username)
    ).all()[:8]
    if admin is not None and admin not in members and p_index == 0:
        members = [admin, *members]
    people = [member.id for member in members] or [None]
    base = dict(project_id=project.id, organization_id=project.organization_id)

    # ── epics ──
    epics = []
    for e_index in range(3 if p_index < 2 else 2):
        title, color = epic_cycle[(p_index * 3 + e_index) % len(epic_cycle)]
        start = today - timedelta(days=rng.randint(40, 70) - e_index * 12)
        end = today + timedelta(days=rng.randint(25, 80) + e_index * 10)
        epics.append(make(
            **base, title=title, kind="EPIC", status="IN_PROGRESS", priority="HIGH",
            description=f"Everything it takes to ship {title.lower()}.",
            start_date=_at(start), due_date=_at(end), cover_color=color,
            assignee_id=rng.choice(people), progress=rng.randint(20, 60),
            created_at=_at(start - timedelta(days=5)), started_at=_at(start),
        ))
    counts["epics"] += len(epics)

    s.session, s.rng, s.today, s.make, s.counts, s.admin, s.epic_cycle, s.projects, s.p_index, s.project, s.people, s.base, s.epics, s.extra, s.work, s.pool, s.scope = (
        session, rng, today, make, counts, admin, epic_cycle, projects, p_index, project, people, base, epics, extra, work, pool, scope,
    )


def _work(s) -> None:
    """The project's work: what was seeded, and a sprint's worth more."""
    session, rng, today, make, counts, admin, epic_cycle, projects, p_index, project, people, base, epics, extra, work, pool, scope = (
        s.session, s.rng, s.today, s.make, s.counts, s.admin, s.epic_cycle, s.projects, s.p_index, s.project, s.people, s.base, s.epics, s.extra, s.work, s.pool, s.scope,
    )
    # ── the project's work: what was seeded, and a sprint's worth more ──
    existing = session.scalars(
        select(Task).where(Task.project_id == project.id, Task.kind != "EPIC", Task.deleted_at.is_(None),
                           Task.parent_id.is_(None))
    ).unique().all()
    stories = list(STORIES)
    rng.shuffle(stories)
    extra = []
    for s_index in range(42):
        is_bug = rng.random() < 0.18
        title = rng.choice(BUGS) if is_bug else stories[s_index % len(stories)]
        extra.append(make(
            **base, title=title, kind="BUG" if is_bug else "STORY",
            status="NEW", priority=rng.choice(("LOW", "NORMAL", "NORMAL", "HIGH", "CRITICAL")),
            description="Acceptance criteria are on the epic's page. Raise a blocker rather than working around it.",
            assignee_id=rng.choice(people), requester_id=rng.choice(people),
            estimate_hours=Decimal(rng.choice((2, 4, 6, 8, 12, 16, 24))), logged_hours=0, progress=0,
            created_at=_at(today - timedelta(days=rng.randint(60, 110))),
            checklist=[{"text": step, "done": False} for step in rng.sample(
                ("Acceptance criteria agreed", "Design reviewed", "Implemented", "Unit tests", "Code review", "Demoed"),
                rng.randint(0, 4))] or None,
        ))
    work = existing + extra
    for row in work:
        row.story_points = Decimal(rng.choice(POINTS))
        if rng.random() < 0.8:
            row.epic_id = rng.choice(epics).id
        if rng.random() < 0.12:
            row.cover_color = rng.choice(("#2457D6", "#7c3aed", "#16a34a", "#ca8a04", "#dc2626", "#0891b2"))

    s.session, s.rng, s.today, s.make, s.counts, s.admin, s.epic_cycle, s.projects, s.p_index, s.project, s.people, s.base, s.epics, s.extra, s.work, s.pool, s.scope = (
        session, rng, today, make, counts, admin, epic_cycle, projects, p_index, project, people, base, epics, extra, work, pool, scope,
    )
