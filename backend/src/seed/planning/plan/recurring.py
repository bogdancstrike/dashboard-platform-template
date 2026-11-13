"""Planning seed: WIP limits, templates, recurring tasks, and the pipeline that runs every step."""

from __future__ import annotations

import random
from datetime import timedelta
from decimal import Decimal
from types import SimpleNamespace

from sqlalchemy import func, select

from src.core.clock import now
from src.models.business import Project, Task
from src.models.identity import User
from src.models.planning import (
    TaskLaneSetting,
    TaskRecurrence,
    TaskTemplate,
    TaskWatcher,
)
from src.seed.planning.history import _Maker, _recount
from src.seed.planning.plan.sprints import _backlog_and_timeline, _sprints
from src.seed.planning.plan.work import _team_and_epics, _work
from src.seed.planning.templates import EPICS, RECURRING, SEED, TEMPLATES, _at


def _watchers(s) -> None:
    """Who watches the epics and the running sprint."""
    session, rng, today, make, counts, admin, epic_cycle, projects, p_index, project, people, base, epics, extra, work, pool, scope = (
        s.session, s.rng, s.today, s.make, s.counts, s.admin, s.epic_cycle, s.projects, s.p_index, s.project, s.people, s.base, s.epics, s.extra, s.work, s.pool, s.scope,
    )
    if admin is not None:
        for row in scope[:4]:
            session.add(TaskWatcher(task_id=row.id, user_id=admin.id, created_at=now() - timedelta(days=2)))
            counts["watchers"] += 1

    for epic in epics:
        children = [row for row in work if row.epic_id == epic.id]
        if children:
            epic.progress = round(100 * sum(1 for row in children if row.status == "DONE") / len(children))
    session.flush()

    s.session, s.rng, s.today, s.make, s.counts, s.admin, s.epic_cycle, s.projects, s.p_index, s.project, s.people, s.base, s.epics, s.extra, s.work, s.pool, s.scope = (
        session, rng, today, make, counts, admin, epic_cycle, projects, p_index, project, people, base, epics, extra, work, pool, scope,
    )


def _wip_limits(s) -> None:
    """WIP limits: one lane over its limit, so the warning is seen."""
    session, rng, today, make, counts, admin, epic_cycle, projects, p_index, project, people, base, epics, extra, work, pool, scope = (
        s.session, s.rng, s.today, s.make, s.counts, s.admin, s.epic_cycle, s.projects, s.p_index, s.project, s.people, s.base, s.epics, s.extra, s.work, s.pool, s.scope,
    )
    # ── WIP limits: one lane over its limit, so the warning is seen ──
    counted = dict(session.execute(
        select(Task.status, func.count()).where(Task.deleted_at.is_(None)).group_by(Task.status)
    ).all())
    for status, slack in (("IN_PROGRESS", 10), ("IN_REVIEW", -3), ("BLOCKED", 5)):
        session.merge(TaskLaneSetting(status=status, wip_limit=max(1, counted.get(status, 0) + slack), updated_at=now()))

    s.session, s.rng, s.today, s.make, s.counts, s.admin, s.epic_cycle, s.projects, s.p_index, s.project, s.people, s.base, s.epics, s.extra, s.work, s.pool, s.scope = (
        session, rng, today, make, counts, admin, epic_cycle, projects, p_index, project, people, base, epics, extra, work, pool, scope,
    )


def _templates(s) -> None:
    """Task templates."""
    session, rng, today, make, counts, admin, epic_cycle, projects, p_index, project, people, base, epics, extra, work, pool, scope = (
        s.session, s.rng, s.today, s.make, s.counts, s.admin, s.epic_cycle, s.projects, s.p_index, s.project, s.people, s.base, s.epics, s.extra, s.work, s.pool, s.scope,
    )
    # ── templates ──
    for spec in TEMPLATES:
        session.add(TaskTemplate(
            name=spec["name"], title=spec["title"], description=spec["description"], kind=spec["kind"],
            priority=spec["priority"], estimate_hours=Decimal(spec["estimate_hours"]),
            story_points=Decimal(spec["story_points"]) if spec["story_points"] else None,
            checklist=[{"text": text, "done": False} for text in spec["checklist"]],
            cover_color=spec["cover_color"], due_in_days=spec["due_in_days"],
            usage_count=rng.randint(2, 30), owner_id=admin.id if admin else None,
        ))
        counts["templates"] += 1

    s.session, s.rng, s.today, s.make, s.counts, s.admin, s.epic_cycle, s.projects, s.p_index, s.project, s.people, s.base, s.epics, s.extra, s.work, s.pool, s.scope = (
        session, rng, today, make, counts, admin, epic_cycle, projects, p_index, project, people, base, epics, extra, work, pool, scope,
    )


def _recurring(s) -> None:
    """Recurring tasks, each with the occurrences it has already made."""
    session, rng, today, make, counts, admin, epic_cycle, projects, p_index, project, people, base, epics, extra, work, pool, scope = (
        s.session, s.rng, s.today, s.make, s.counts, s.admin, s.epic_cycle, s.projects, s.p_index, s.project, s.people, s.base, s.epics, s.extra, s.work, s.pool, s.scope,
    )
    # ── recurring tasks, each with the occurrences it has already made ──
    from src.services.work.task_templates import next_after

    project = projects[0]
    for title, rule_spec, past in RECURRING:
        source = make(
            project_id=project.id, organization_id=project.organization_id, title=title,
            kind="CHORE", status="DONE", priority="NORMAL", progress=100, logged_hours=Decimal(1),
            estimate_hours=Decimal(1), assignee_id=project.owner_id,
            start_date=_at(today - timedelta(days=30)), due_date=_at(today - timedelta(days=30)),
            completed_at=_at(today - timedelta(days=30)), created_at=_at(today - timedelta(days=45)),
            checklist=[{"text": "Collect the numbers", "done": True}, {"text": "Write it up", "done": True}],
        )
        rule = TaskRecurrence(
            task_id=source.id, frequency=rule_spec["frequency"], interval=rule_spec.get("interval", 1),
            unit=rule_spec.get("unit", "DAY"), weekdays=rule_spec.get("weekdays"),
            month_day=rule_spec.get("month_day"), active=True, occurrences=0,
            created_by_id=admin.id if admin else None,
        )
        session.add(rule)
        session.flush()
        moment = _at(today - timedelta(days=30)) + timedelta(hours=6)
        produced = 0
        while produced < 6:
            following = next_after(rule, moment)
            if following is None or following > now():
                break
            moment = following
            produced += 1
        # Leave the latest one or two open, the rest done.
        moment = _at(today - timedelta(days=30)) + timedelta(hours=6)
        for index in range(produced):
            moment = next_after(rule, moment)
            open_one = index >= produced - past
            make(
                project_id=project.id, organization_id=project.organization_id, title=title,
                kind="CHORE", status="NEW" if open_one else "DONE", priority="NORMAL",
                progress=0 if open_one else 100, logged_hours=Decimal(0 if open_one else 1),
                estimate_hours=Decimal(1), assignee_id=project.owner_id, recurrence_id=rule.id,
                start_date=moment.replace(hour=0), due_date=moment.replace(hour=0),
                completed_at=None if open_one else moment + timedelta(hours=4),
                created_at=moment, checklist=[{"text": "Collect the numbers", "done": False}, {"text": "Write it up", "done": False}],
            )
        rule.occurrences = produced
        rule.last_run_at = moment if produced else None
        rule.next_run_at = next_after(rule, max(moment, now()))
        counts["recurrences"] += 1

    counts["tasks"] = make.made
    session.flush()
    _recount(session, projects)
    s.session, s.rng, s.today, s.make, s.counts, s.admin, s.epic_cycle, s.projects, s.p_index, s.project, s.people, s.base, s.epics, s.extra, s.work, s.pool, s.scope = (
        session, rng, today, make, counts, admin, epic_cycle, projects, p_index, project, people, base, epics, extra, work, pool, scope,
    )


#: Run per project, in order.
PROJECT_STEPS = (_team_and_epics, _work, _sprints, _backlog_and_timeline, _watchers)


#: Run once after every project.
FINISHING_STEPS = (_wip_limits, _templates, _recurring)


def _plan(session) -> dict[str, int]:
    """The planning world, built step by step on one shared state."""

    rng = random.Random(SEED)
    today = now().date()
    make = _Maker(session)
    counts = {"epics": 0, "sprints": 0, "snapshots": 0, "dependencies": 0, "milestones": 0,
              "templates": 0, "recurrences": 0, "watchers": 0}

    projects = session.scalars(
        select(Project).where(Project.status == "ACTIVE", Project.deleted_at.is_(None)).order_by(Project.code)
    ).unique().all()[:4]
    if not projects:
        return counts
    admin = session.scalars(select(User).where(User.username == "admin")).first()

    # Stray random EPIC/STORY kinds from the base seed are not real epics.
    for row in session.scalars(select(Task).where(Task.kind == "EPIC", Task.epic_id.is_(None))).unique().all():
        if not session.scalar(select(func.count()).select_from(Task).where(Task.epic_id == row.id)):
            row.kind = "FEATURE"

    epic_cycle = list(EPICS)
    s = SimpleNamespace(
        session=session, rng=rng, today=today, make=make, counts=counts, admin=admin, epic_cycle=epic_cycle, projects=projects, p_index=None, project=None, people=None, base=None, epics=None, extra=None, work=None, pool=None, scope=None,
    )
    for s.p_index, s.project in enumerate(projects):
        for step in PROJECT_STEPS:
            step(s)
    for step in FINISHING_STEPS:
        step(s)
    return counts
