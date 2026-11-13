"""Seed data for business: _projects, _calendar."""

from __future__ import annotations

from datetime import timedelta

from src.core import vocabulary
from src.seed import catalog
from src.seed.support import reference
from src.seed.world import World


def _projects(world: World) -> None:
    from src.models.business import Project

    rng = world.rng.derive("projects")
    regions_by_code = {region.code: region for region in world.regions}
    customers_by_org: dict = {}
    for customer in world.customers:
        customers_by_org.setdefault(customer.organization_id, []).append(customer)

    departments_by_org: dict = {}
    for department in world.departments:
        departments_by_org.setdefault(department.organization_id, []).append(department)

    for index in range(world.scale.projects):
        organization = rng.pick(world.organizations)
        members = world.users_by_org.get(organization.id, [])
        customers = customers_by_org.get(organization.id, [])
        departments = departments_by_org.get(organization.id, [])
        status = rng.weighted(catalog.PROJECT_STATUSES)

        start = rng.ago(days_min=10, days_max=700)
        due = start + timedelta(days=rng.integer(45, 420))
        completed = None
        if status in ("COMPLETED", "ARCHIVED"):
            completed = rng.between(start, min(due, world.anchor))
        progress = {
            "COMPLETED": 100, "ARCHIVED": 100, "CANCELLED": rng.integer(5, 70),
            "PLANNING": rng.integer(0, 15), "ON_HOLD": rng.integer(10, 70),
        }.get(status, rng.integer(15, 95))

        budget = rng.money(20_000, 2_400_000, step=5_000)
        world.projects.append(
            Project(
                id=rng.uuid(),
                code=reference("PRJ", index + 1, width=4),
                name=f"{rng.pick(catalog.PROJECT_ADJECTIVES)} {rng.pick(catalog.PROJECT_SUBJECTS)}",
                description=(
                    "Programme of work covering discovery, delivery and rollout, "
                    "with a phased migration and a fallback plan for each stage."
                ),
                status=status,
                phase=(
                    "CLOSURE" if status in ("COMPLETED", "ARCHIVED")
                    else rng.pick(catalog.PROJECT_PHASES)
                ),
                priority=rng.weighted(catalog.PRIORITIES),
                health=(
                    "ON_TRACK" if status in ("COMPLETED", "ARCHIVED")
                    else rng.weighted(catalog.PROJECT_HEALTH)
                ),
                organization_id=organization.id,
                department_id=rng.pick(departments).id if departments else None,
                owner_id=rng.pick(members).id if members else None,
                customer_id=rng.pick(customers).id if customers and rng.chance(0.7) else None,
                region_id=regions_by_code[rng.pick(catalog.LOCATIONS)[2]].id,
                start_date=start,
                due_date=due,
                completed_at=completed,
                budget=budget,
                # Overspend on a minority, because "spent vs budget" is only a
                # useful chart when some bars cross the line.
                spent=round(budget * (rng.decimal(0.05, 1.25) if rng.chance(0.25) else rng.decimal(0.05, 0.95)), 2),
                currency=rng.pick(catalog.ORDER_CURRENCIES),
                progress=progress,
                color=rng.pick(("#5b5bd6", "#0891b2", "#16a34a", "#ca8a04", "#dc2626", "#7c3aed")),
                created_at=start,
                metadata_json={"methodology": rng.pick(("Agile", "Waterfall", "Hybrid"))},
            )
        )


def _calendar(world: World) -> None:
    from src.models.business import CalendarEvent

    rng = world.rng.derive("calendar")
    projects_by_org: dict = {}
    for project in world.projects:
        projects_by_org.setdefault(project.organization_id, []).append(project)
    tasks_by_project: dict = {}
    for task in world.tasks:
        tasks_by_project.setdefault(task.project_id, []).append(task)

    for _ in range(world.scale.calendar_events):
        organization = rng.pick(world.organizations)
        members = world.users_by_org.get(organization.id, [])
        projects = projects_by_org.get(organization.id, [])
        category = rng.weighted(catalog.EVENT_CATEGORIES)

        # Half in the recent past, half ahead — a calendar that only looks
        # backwards has nothing to remind anyone about.
        starts = rng.business_hour(
            rng.recent(days=45) if rng.chance(0.5) else rng.ahead(days_min=0, days_max=60)
        )
        all_day = category == "HOLIDAY" or rng.chance(0.1)
        ends = (
            starts + timedelta(days=1) if all_day
            else starts + timedelta(minutes=rng.pick((15, 30, 45, 60, 90, 120, 240)))
        )

        project = rng.pick(projects) if projects and rng.chance(0.55) else None
        tasks = tasks_by_project.get(project.id, []) if project else []
        attendees = rng.sample(members, rng.integer(1, min(8, len(members)))) if members else []

        recurring = rng.chance(0.22)
        world.calendar_events.append(
            CalendarEvent(
                id=rng.uuid(),
                title=rng.pick(catalog.EVENT_TITLES),
                description=rng.maybe("Agenda and prior notes are linked from the project page.", 0.5),
                category=category,
                status=rng.weighted(catalog.EVENT_STATUSES),
                location=rng.pick(catalog.MEETING_ROOMS),
                starts_at=starts,
                ends_at=ends,
                all_day=all_day,
                organizer_id=attendees[0].id if attendees else None,
                organization_id=organization.id,
                project_id=project.id if project else None,
                task_id=rng.pick(tasks).id if tasks and rng.chance(0.3) else None,
                participants=[
                    {
                        "user_id": str(person.id),
                        "name": person.full_name,
                        "email": person.email,
                        "response": rng.weighted(catalog.EVENT_RESPONSES),
                    }
                    for person in attendees
                ] or None,
                recurrence=(
                    {
                        "freq": rng.pick(vocabulary.EVENT_FREQUENCY),
                        "interval": rng.integer(1, 3),
                        "byday": rng.sample(("MO", "TU", "WE", "TH", "FR"), rng.integer(1, 3)),
                    }
                    if recurring else None
                ),
                # Materialised so a month view can range-scan instead of
                # expanding every series it might overlap.
                recurrence_until=rng.ahead(days_min=30, days_max=400) if recurring else None,
                reminder_minutes=rng.maybe(rng.pick((5, 10, 15, 30, 60)), 0.65),
                color=rng.pick(("#5b5bd6", "#0891b2", "#16a34a", "#ca8a04", "#dc2626")),
                created_at=rng.ago(days_min=1, days_max=200),
            )
        )
