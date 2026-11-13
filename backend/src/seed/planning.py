"""Work planning demo data: sprints with history, epics, a timeline worth reading (§18).

Runs *after* the main graph is written, against the session, because it plans
work that already exists: it reads the seeded projects and tasks and gives a
handful of active projects the shape an agile team's would have — epics, story
points, four finished sprints and one running (with a burndown that has a
history), a ranked backlog, milestones and a chain of dependencies on the
timeline. Everything is dated relative to now.

Idempotent, so the same function is the `--sync-planning` repair for a
database seeded before planning existed: the structural part (epics, sprints,
templates, recurrences) is only added when no sprint exists yet, and the
fill-ins (start dates, lane ages, scheduled jobs) only touch what is empty.
"""

from __future__ import annotations

import random
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal
from typing import Any

from sqlalchemy import func, select

from src.core.clock import now

POINTS = (1, 2, 3, 5, 5, 8, 13)
SEED = 20261112

EPICS = (
    ("Customer self-service portal", "#2457D6"),
    ("Billing platform migration", "#7c3aed"),
    ("Mobile field app", "#0891b2"),
    ("Data warehouse refresh", "#16a34a"),
    ("Single sign-on rollout", "#ca8a04"),
    ("Observability and alerting", "#dc2626"),
    ("Partner API v2", "#db2777"),
    ("Onboarding redesign", "#0d9488"),
)
STORIES = (
    "Sign-in with the company identity provider", "Invoice PDF matches the legal template",
    "Search orders by customer reference", "Export the ledger to CSV", "Offline mode for site visits",
    "Push notification when a job is assigned", "Dashboard of overdue invoices",
    "Rate-limit the public API", "Audit trail for price changes", "Bulk import of devices",
    "Password reset by SMS", "Payment retry on card decline", "Map view of open work orders",
    "Health check for the payment gateway", "Webhook for order status changes",
    "Archive tickets older than two years", "Role for read-only auditors", "Customer churn report",
    "Feature flag for the new checkout", "Accessibility pass on the forms",
    "Translate the portal into German", "Reconcile refunds nightly", "Trace slow database queries",
    "Alert when the queue backs up", "Self-service address change", "Contract renewal reminders",
    "Photo upload on inspections", "Signature capture on delivery", "SLA timer on priority tickets",
    "Usage metering per API key", "Merge duplicate customers", "Two-factor for administrators",
)
BUGS = (
    "Totals off by a cent on multi-currency orders", "Session expires during long uploads",
    "Date picker shows the wrong week start", "Duplicate notification on reassign",
    "Export times out over 50k rows", "Avatar missing for new users", "Search ignores accents",
)
MILESTONES = ("Beta to pilot customers", "General availability", "Security review signed off", "Data migration cut-over")
BLOCKERS = (
    "Waiting on the vendor's sandbox credentials", "Needs a decision from legal on retention",
    "Blocked by the identity provider upgrade", "Design sign-off pending",
)
TEMPLATES = (
    {
        "name": "Bug triage", "title": "Triage: ", "kind": "BUG", "priority": "HIGH",
        "estimate_hours": 2, "story_points": 2, "due_in_days": 2, "cover_color": "#dc2626",
        "description": "Reproduce, assess impact, assign an owner and a target release.",
        "checklist": ["Reproduce on staging", "Capture logs and correlation id", "Assess customer impact", "Assign owner and release"],
    },
    {
        "name": "Release checklist", "title": "Release ", "kind": "CHORE", "priority": "NORMAL",
        "estimate_hours": 6, "story_points": 3, "due_in_days": 5, "cover_color": "#2457D6",
        "description": "Everything a release needs before it leaves staging.",
        "checklist": ["Freeze the branch", "Run the regression suite", "Write release notes", "Deploy to production", "Watch the error rate for an hour"],
    },
    {
        "name": "New starter onboarding", "title": "Onboard ", "kind": "REQUEST", "priority": "NORMAL",
        "estimate_hours": 8, "story_points": None, "due_in_days": 10, "cover_color": "#16a34a",
        "description": "Accounts, hardware and a buddy for somebody joining the team.",
        "checklist": ["Order the laptop", "Create accounts", "Add to the team channels", "Pair with a buddy for week one", "30-day check-in"],
    },
    {
        "name": "Security patch", "title": "Patch: ", "kind": "TASK", "priority": "CRITICAL",
        "estimate_hours": 4, "story_points": 3, "due_in_days": 3, "cover_color": "#ca8a04",
        "description": "Apply and verify a security update across the fleet.",
        "checklist": ["Read the advisory", "Patch staging", "Patch production", "Verify versions", "Close the advisory"],
    },
    {
        "name": "User story", "title": "As a customer, I want ", "kind": "STORY", "priority": "NORMAL",
        "estimate_hours": 12, "story_points": 5, "due_in_days": 14, "cover_color": None,
        "description": "So that … Acceptance criteria: …",
        "checklist": ["Acceptance criteria agreed", "Design reviewed", "Implemented", "Tested", "Demoed"],
    },
)
RECURRING = (
    ("Weekly operations review", {"frequency": "WEEKLY", "weekdays": [0]}, 1),
    ("Rotate on-call handover notes", {"frequency": "WEEKLY", "weekdays": [4]}, 1),
    ("Month-end invoice reconciliation", {"frequency": "MONTHLY", "month_day": 28}, 3),
    ("Sprint retrospective actions review", {"frequency": "CUSTOM", "interval": 2, "unit": "WEEK"}, 1),
    ("Back up the reporting database", {"frequency": "DAILY"}, 1),
)


def _at(day: date) -> datetime:
    return datetime.combine(day, time(0, 0), tzinfo=timezone.utc)


def _day(value: Any) -> date | None:
    if value is None:
        return None
    return value.astimezone(timezone.utc).date() if isinstance(value, datetime) else value


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


def _fill_dates(session) -> int:
    """Every open task gets a start date, so the timeline draws it as a bar."""
    from src.models.business import Task

    rng = random.Random(SEED + 1)
    rows = session.scalars(
        select(Task).where(Task.start_date.is_(None), Task.due_date.is_not(None), Task.deleted_at.is_(None))
    ).unique().all()
    for row in rows:
        hours = float(row.estimate_hours or 8)
        length = max(1, min(21, round(hours / 6) + rng.randint(0, 3)))
        start = _day(row.due_date) - timedelta(days=length)
        created = _day(row.created_at)
        if created and start < created:
            start = created
        row.start_date = _at(start)
    return len(rows)


def _fill_ages(session) -> int:
    """How long each card has sat in its lane — from its last plausible move."""
    from src.models.business import Task

    rng = random.Random(SEED + 2)
    rows = session.scalars(
        select(Task).where(Task.status_changed_at.is_(None), Task.deleted_at.is_(None))
    ).unique().all()
    anchor = now()
    for row in rows:
        lower = row.started_at or row.created_at or anchor - timedelta(days=30)
        if row.completed_at:
            row.status_changed_at = row.completed_at
            continue
        span = max(0, int((anchor - lower).total_seconds()))
        moved = lower + timedelta(seconds=rng.randint(0, span)) if span else lower
        # Most cards moved recently; a few have been stuck a long while.
        if rng.random() < 0.7:
            moved = max(moved, anchor - timedelta(days=rng.randint(0, 6), hours=rng.randint(0, 20)))
        row.status_changed_at = moved
    return len(rows)


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


def _plan(session) -> dict[str, int]:
    from src.models.business import Project, Task
    from src.models.identity import User
    from src.models.planning import (
        Sprint, SprintSnapshot, TaskDependency, TaskLaneSetting, TaskRecurrence, TaskTemplate,
        TaskWatcher,
    )

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
    for p_index, project in enumerate(projects):
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

        # ── sprints: four finished, one running, one planned ──
        length = 14
        active_start = today - timedelta(days=6)
        pool = list(extra)
        rng.shuffle(pool)
        velocity_targets = (21, 26, 18, 29)
        for s_index in range(4):
            start = active_start - timedelta(days=length * (4 - s_index))
            end = start + timedelta(days=length - 1)
            scope = [pool.pop() for _ in range(min(len(pool), 6))]
            committed = sum(float(row.story_points) for row in scope)
            target = min(committed, velocity_targets[s_index])
            done_points = 0.0
            done_rows, carried = [], []
            for row in scope:
                if done_points + float(row.story_points) <= target + 3:
                    done_rows.append(row)
                    done_points += float(row.story_points)
                else:
                    carried.append(row)
            sprint = Sprint(
                project_id=project.id, name=f"{project.code} Sprint {s_index + 1}",
                goal=rng.choice((
                    "Ship the first slice to pilot customers", "Close the billing gaps finance raised",
                    "Make sign-in boring", "Burn down the bug backlog", "Get the API ready for partners",
                )),
                state="COMPLETED", start_date=start, end_date=end,
                capacity_points=Decimal(30), committed_points=Decimal(str(committed)),
                completed_points=Decimal(str(done_points)), started_at=_at(start),
                completed_at=_at(end) + timedelta(hours=17), created_by_id=admin.id if admin else None,
                created_at=_at(start - timedelta(days=3)),
            )
            session.add(sprint)
            session.flush()
            for row in done_rows:
                finished = _at(start + timedelta(days=rng.randint(2, length - 1))) + timedelta(hours=rng.randint(9, 17))
                row.sprint_id = sprint.id
                row.sprint_added_at = _at(start)
                row.status = "DONE"
                row.progress = 100
                row.start_date = _at(start + timedelta(days=rng.randint(0, 4)))
                row.due_date = _at(end)
                row.started_at = row.start_date
                row.completed_at = finished
                row.status_changed_at = finished
                row.logged_hours = row.estimate_hours
            sprint.report = {
                "committed_points": committed, "completed_points": done_points,
                "completed": [row.reference for row in done_rows],
                "carried_over": [row.reference for row in carried],
                "carried_to": "backlog" if s_index < 3 else "next",
                "added_after_start": [], "total_tasks": len(scope), "done_tasks": len(done_rows),
            }
            # Carried work goes back into the pool for the next sprint.
            pool.extend(carried)
            counts["snapshots"] += _history(session, sprint, scope, done_rows, rng)
            counts["sprints"] += 1

        # The running sprint: started six days ago, eight to go.
        active_end = active_start + timedelta(days=length - 1)
        active = Sprint(
            project_id=project.id, name=f"{project.code} Sprint 5",
            goal="Pilot customers can pay their invoices online", state="ACTIVE",
            start_date=active_start, end_date=active_end, capacity_points=Decimal(30),
            started_at=_at(active_start), created_by_id=admin.id if admin else None,
            created_at=_at(active_start - timedelta(days=2)),
        )
        session.add(active)
        session.flush()
        scope = [pool.pop() for _ in range(min(len(pool), 10))]
        statuses = ("DONE", "DONE", "DONE", "IN_REVIEW", "IN_PROGRESS", "IN_PROGRESS", "IN_PROGRESS",
                    "BLOCKED", "ASSIGNED", "NEW")
        done_rows = []
        for index, row in enumerate(scope):
            status = statuses[index % len(statuses)]
            row.sprint_id = active.id
            # Two were added mid-sprint, which the report shows.
            row.sprint_added_at = _at(active_start + timedelta(days=3)) if index in (8, 9) else _at(active_start)
            row.status = status
            row.start_date = _at(active_start + timedelta(days=rng.randint(0, 5)))
            row.due_date = _at(active_end - timedelta(days=rng.randint(0, 4)))
            row.started_at = row.start_date if status != "NEW" else None
            row.progress = {"DONE": 100, "IN_REVIEW": 90, "IN_PROGRESS": rng.randint(20, 70), "BLOCKED": 40}.get(status, 0)
            row.status_changed_at = now() - timedelta(days=rng.randint(0, 5), hours=rng.randint(1, 20))
            if status == "DONE":
                row.completed_at = row.status_changed_at
                done_rows.append(row)
            if status == "BLOCKED":
                row.blocked_reason = rng.choice(BLOCKERS)
        committed = sum(float(row.story_points) for index, row in enumerate(scope) if index not in (8, 9))
        active.committed_points = Decimal(str(committed))
        counts["snapshots"] += _history(session, active, scope, done_rows, rng, upto=today - timedelta(days=1))
        counts["sprints"] += 1

        planned_start = active_end + timedelta(days=1)
        planned = Sprint(
            project_id=project.id, name=f"{project.code} Sprint 6", goal="Open the partner API to the first two partners",
            state="PLANNED", start_date=planned_start, end_date=planned_start + timedelta(days=length - 1),
            capacity_points=Decimal(28), created_by_id=admin.id if admin else None,
        )
        session.add(planned)
        session.flush()
        for row in [pool.pop() for _ in range(min(len(pool), 5))]:
            row.sprint_id = planned.id
            row.sprint_added_at = now() - timedelta(days=1)
            row.start_date = _at(planned_start + timedelta(days=rng.randint(0, 6)))
            row.due_date = row.start_date + timedelta(days=rng.randint(2, 7))
        counts["sprints"] += 1

        # ── the backlog: what is left, ranked, scheduled further out ──
        for rank, row in enumerate(sorted(pool, key=lambda item: (item.priority != "CRITICAL", item.priority != "HIGH", item.reference)), start=1):
            row.backlog_rank = rank * 1024.0
            row.start_date = _at(today + timedelta(days=14 + rank * 2))
            row.due_date = row.start_date + timedelta(days=rng.randint(3, 10))

        # ── milestones and a dependency chain on the timeline ──
        for m_index, title in enumerate(MILESTONES[: 2 if p_index else 3]):
            day = today + timedelta(days=12 + m_index * 25)
            make(**base, title=title, kind="TASK", status="NEW", priority="HIGH", is_milestone=True,
                 start_date=_at(day), due_date=_at(day), progress=0, logged_hours=0,
                 assignee_id=project.owner_id, epic_id=epics[m_index % len(epics)].id,
                 created_at=_at(today - timedelta(days=30)))
            counts["milestones"] += 1

        chain_rows = sorted(
            [row for row in work if row.status != "DONE" and row.start_date is not None and row.due_date is not None],
            key=lambda item: item.start_date,
        )[:10]
        for left, right in zip(chain_rows, chain_rows[1:]):
            if rng.random() < 0.25:
                continue
            gap = (_day(left.due_date) - _day(right.start_date)).days + 1
            if gap > 0 and rng.random() < 0.85:
                right.start_date = right.start_date + timedelta(days=gap)
                right.due_date = right.due_date + timedelta(days=gap)
            session.add(TaskDependency(predecessor_id=left.id, successor_id=right.id, kind="FS",
                                       lag_days=0, created_by_id=admin.id if admin else None))
            counts["dependencies"] += 1

        if admin is not None:
            for row in scope[:4]:
                session.add(TaskWatcher(task_id=row.id, user_id=admin.id, created_at=now() - timedelta(days=2)))
                counts["watchers"] += 1

        for epic in epics:
            children = [row for row in work if row.epic_id == epic.id]
            if children:
                epic.progress = round(100 * sum(1 for row in children if row.status == "DONE") / len(children))
        session.flush()

    # ── WIP limits: one lane over its limit, so the warning is seen ──
    counted = dict(session.execute(
        select(Task.status, func.count()).where(Task.deleted_at.is_(None)).group_by(Task.status)
    ).all())
    for status, slack in (("IN_PROGRESS", 10), ("IN_REVIEW", -3), ("BLOCKED", 5)):
        session.merge(TaskLaneSetting(status=status, wip_limit=max(1, counted.get(status, 0) + slack), updated_at=now()))

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
    return counts


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
