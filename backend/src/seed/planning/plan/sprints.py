"""Planning seed steps: sprints, the backlog, the timeline and watchers."""

from __future__ import annotations

from datetime import timedelta
from decimal import Decimal

from src.core.clock import now
from src.models.planning import Sprint, TaskDependency
from src.seed.planning.history import _history
from src.seed.planning.templates import BLOCKERS, MILESTONES, _at, _day


def _sprints(s) -> None:
    """Sprints: four finished, one running, one planned."""
    session, rng, today, make, counts, admin, epic_cycle, projects, p_index, project, people, base, epics, extra, work, pool, scope = (
        s.session, s.rng, s.today, s.make, s.counts, s.admin, s.epic_cycle, s.projects, s.p_index, s.project, s.people, s.base, s.epics, s.extra, s.work, s.pool, s.scope,
    )
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

    s.session, s.rng, s.today, s.make, s.counts, s.admin, s.epic_cycle, s.projects, s.p_index, s.project, s.people, s.base, s.epics, s.extra, s.work, s.pool, s.scope = (
        session, rng, today, make, counts, admin, epic_cycle, projects, p_index, project, people, base, epics, extra, work, pool, scope,
    )


def _backlog_and_timeline(s) -> None:
    """The backlog, milestones and a dependency chain."""
    session, rng, today, make, counts, admin, epic_cycle, projects, p_index, project, people, base, epics, extra, work, pool, scope = (
        s.session, s.rng, s.today, s.make, s.counts, s.admin, s.epic_cycle, s.projects, s.p_index, s.project, s.people, s.base, s.epics, s.extra, s.work, s.pool, s.scope,
    )
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

    s.session, s.rng, s.today, s.make, s.counts, s.admin, s.epic_cycle, s.projects, s.p_index, s.project, s.people, s.base, s.epics, s.extra, s.work, s.pool, s.scope = (
        session, rng, today, make, counts, admin, epic_cycle, projects, p_index, project, people, base, epics, extra, work, pool, scope,
    )
