"""Seed data for business: _roll_up_task_counts, _cover_every_task_status, _tasks."""

from __future__ import annotations

from datetime import timedelta

from src.seed import catalog
from src.seed.support import reference
from src.seed.world import World


def _tasks(world: World) -> None:
    """Tasks, then subtasks for a slice of them.

    Parents are appended first: `tasks.parent_id` references this same table,
    so a subtask inserted before its parent is a foreign key violation.
    """
    from src.models.business import Task

    rng = world.rng.derive("tasks")
    if not world.projects:
        return

    counter = 0
    parents: list = []

    def _make(project, parent=None) -> Task:
        nonlocal counter
        counter += 1
        members = world.users_by_org.get(project.organization_id, [])
        status = rng.weighted(catalog.TASK_STATUSES)
        created = rng.between(project.start_date or rng.ago(days_max=300), world.anchor)
        due = created + timedelta(days=rng.integer(2, 90))
        started = rng.between(created, world.anchor) if status not in ("NEW",) else None
        completed = rng.between(started or created, world.anchor) if status == "DONE" else None
        estimate = rng.decimal(0.5, 40)

        return Task(
            id=rng.uuid(),
            reference=reference("TSK", counter),
            title=f"{rng.pick(catalog.TASK_VERBS)} {rng.pick(catalog.TASK_OBJECTS)}",
            description=rng.maybe(
                "Context, acceptance criteria and the rollback plan are in the "
                "linked document. Raise a blocker rather than working around it.",
                0.72,
            ),
            status=status,
            priority=rng.weighted(catalog.PRIORITIES),
            kind=rng.pick(catalog.TASK_KINDS),
            project_id=project.id,
            organization_id=project.organization_id,
            assignee_id=rng.pick(members).id if members and rng.chance(0.86) else None,
            requester_id=rng.pick(members).id if members else None,
            parent_id=parent.id if parent else None,
            due_date=due,
            started_at=started,
            completed_at=completed,
            estimate_hours=estimate,
            logged_hours=round(estimate * rng.decimal(0.0, 1.4), 2),
            progress=100 if status == "DONE" else (0 if status == "NEW" else rng.integer(5, 95)),
            # A sparse rank within the column, so drag-and-drop order survives
            # a reload and a drop between two cards writes only the one moved.
            board_position=float(counter * 1024),
            blocked_reason=rng.pick(catalog.BLOCKED_REASONS) if status == "BLOCKED" else None,
            checklist=[
                {"text": item, "done": rng.chance(0.5)}
                for item in rng.sample(
                    ("Reproduce", "Write the fix", "Add a test", "Update the runbook",
                     "Notify support", "Deploy to staging", "Verify in production"),
                    rng.integer(0, 4),
                )
            ] or None,
            created_at=created,
            metadata_json={"source": rng.pick(("board", "import", "api", "email"))},
        )

    target = world.scale.tasks
    subtask_budget = target // 6
    while len(world.tasks) < target - subtask_budget:
        task = _make(rng.pick(world.projects))
        world.tasks.append(task)
        if task.status not in ("DONE", "CANCELLED"):
            parents.append(task)

    projects_by_id = {project.id: project for project in world.projects}
    while len(world.tasks) < target and parents:
        parent = rng.pick(parents)
        world.tasks.append(_make(projects_by_id[parent.project_id], parent=parent))

    _cover_every_task_status(world, rng)
    _roll_up_task_counts(world)


def _cover_every_task_status(world: World, rng) -> None:
    """Make sure every declared status has at least one task.

    The statuses are weighted, so at a small scale one can come out empty —
    and `/tasks` is a *board*, where an empty lane is not a quirk of the data
    but a column of nothing next to six columns of something. It is also a
    ratchet: the end-to-end suite moves a card between lanes and puts it back
    only when it passes, so a run that fails drains the lane it took from.
    `NEW` reached zero that way, after which every later run failed for want
    of a card to drag.

    Reassigns from the fullest lane rather than inventing tasks: the volume
    targets are what the scale asked for, and a seed that quietly builds extra
    rows to satisfy a property is a seed whose counts cannot be relied on.
    """
    from collections import Counter

    from src.core import vocabulary

    for status in vocabulary.TASK_STATUS:
        counted = Counter(task.status for task in world.tasks)
        if counted.get(status, 0) > 0:
            continue
        fullest, _count = counted.most_common(1)[0]
        donor = next(task for task in world.tasks if task.status == fullest)
        donor.status = status
        # The moments have to follow the status, or the board shows a task
        # that is `NEW` and was started last Tuesday.
        if status == "NEW":
            donor.started_at = None
        if status != "DONE":
            donor.completed_at = None
        elif donor.completed_at is None:
            donor.completed_at = rng.between(donor.started_at or donor.created_at, world.anchor)


def _roll_up_task_counts(world: World) -> None:
    """Maintain the denormalised counters on projects.

    They exist so a project list does not need a correlated subquery per row;
    they are only worth having if the seed leaves them true.
    """
    totals: dict = {}
    open_totals: dict = {}
    for task in world.tasks:
        totals[task.project_id] = totals.get(task.project_id, 0) + 1
        if task.status not in ("DONE", "CANCELLED"):
            open_totals[task.project_id] = open_totals.get(task.project_id, 0) + 1
    for project in world.projects:
        project.task_count = totals.get(project.id, 0)
        project.open_task_count = open_totals.get(project.id, 0)
