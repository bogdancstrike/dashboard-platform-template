"""Customers, projects, tasks, tickets, orders, devices and the calendar.

Deliberately not seven variations of one shape. Projects carry budgets and
dates, tickets carry SLA clocks, orders carry money and line items, tasks carry
a kanban lifecycle, devices carry telemetry — so the list, detail and chart
patterns get exercised against data that actually differs.

Statuses are drawn by weight rather than uniformly, which is the difference
between a board that looks like a real backlog and one where every column is
the same height.
"""

from __future__ import annotations

from datetime import timedelta

from src.seed import catalog
from src.seed.support import reference, slugify
from src.seed.world import World


def build(world: World) -> None:
    _customers(world)
    _projects(world)
    _tasks(world)
    _tickets(world)
    _orders(world)
    _devices(world)
    _calendar(world)


def _customers(world: World) -> None:
    from src.models.business import Customer

    rng = world.rng.derive("customers")
    regions_by_code = {region.code: region for region in world.regions}

    for index in range(world.scale.customers):
        root = rng.pick(catalog.ORG_ROOTS)
        suffix = rng.pick(catalog.ORG_SUFFIXES)
        name = f"{root} {suffix}"
        city, country, region_code = rng.pick(catalog.LOCATIONS)
        organization = rng.pick(world.organizations)
        managers = world.users_by_org.get(organization.id, [])
        stage = rng.weighted(catalog.LIFECYCLE_STAGES)
        segment = rng.weighted(catalog.CUSTOMER_SEGMENTS)

        world.customers.append(
            Customer(
                id=rng.uuid(),
                code=reference("CUS", index + 1),
                name=name,
                legal_name=f"{name} International",
                email=f"hello@{slugify(name)}.example",
                phone=rng.maybe(f"+{rng.integer(30, 49)} {rng.integer(20, 89)} {rng.integer(1000000, 9999999)}", 0.85),
                website=rng.maybe(f"https://www.{slugify(name)}.example", 0.7),
                status=rng.weighted(catalog.CUSTOMER_STATUSES),
                segment=segment,
                industry=rng.pick(catalog.INDUSTRIES),
                lifecycle_stage=stage,
                organization_id=organization.id,
                account_manager_id=rng.pick(managers).id if managers else None,
                region_id=regions_by_code[region_code].id,
                country=country,
                city=city,
                lifetime_value={
                    "STRATEGIC": rng.money(400_000, 4_000_000, step=5_000),
                    "ENTERPRISE": rng.money(120_000, 900_000, step=5_000),
                    "MID_MARKET": rng.money(25_000, 200_000, step=1_000),
                    "SMB": rng.money(1_000, 40_000, step=500),
                }[segment],
                open_orders=rng.integer(0, 12),
                # Missing on purpose for about a fifth of rows: the comparison
                # view (§47) needs a metric that is genuinely absent somewhere.
                satisfaction=rng.maybe(rng.integer(1, 10), 0.8),
                last_contact_at=rng.maybe(rng.recent(days=200), 0.88),
                tags=rng.sample([t[0] for t in catalog.TAGS], rng.integer(0, 3)),
                created_at=rng.ago(days_min=30, days_max=1_800),
                metadata_json={"segment": segment, "stage": stage},
            )
        )


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
                tags=rng.sample([t[0] for t in catalog.TAGS], rng.integer(0, 4)),
                color=rng.pick(("#5b5bd6", "#0891b2", "#16a34a", "#ca8a04", "#dc2626", "#7c3aed")),
                created_at=start,
                metadata_json={"methodology": rng.pick(("Agile", "Waterfall", "Hybrid"))},
            )
        )


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
            # Board position within the column, so drag-and-drop order survives
            # a reload rather than resorting on every open.
            board_position=counter % 50,
            blocked_reason=rng.pick(catalog.BLOCKED_REASONS) if status == "BLOCKED" else None,
            tags=rng.sample([t[0] for t in catalog.TAGS], rng.integer(0, 3)),
            checklist=[
                {"label": item, "done": rng.chance(0.5)}
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

    _roll_up_task_counts(world)


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


def _tickets(world: World) -> None:
    from src.models.business import Ticket

    rng = world.rng.derive("tickets")
    customers_by_org: dict = {}
    for customer in world.customers:
        customers_by_org.setdefault(customer.organization_id, []).append(customer)
    projects_by_org: dict = {}
    for project in world.projects:
        projects_by_org.setdefault(project.organization_id, []).append(project)

    for index in range(world.scale.tickets):
        organization = rng.pick(world.organizations)
        members = world.users_by_org.get(organization.id, [])
        customers = customers_by_org.get(organization.id, [])
        projects = projects_by_org.get(organization.id, [])

        status = rng.weighted(catalog.TICKET_STATUSES)
        severity = rng.weighted(catalog.SEVERITIES)
        created = rng.recent(days=180)
        # SLA target scales with severity, which is what makes "breached" mean
        # something different for a critical ticket than for a minor one.
        sla_hours = {"CRITICAL": 4, "MAJOR": 12, "MODERATE": 48, "MINOR": 120}[severity]
        due = created + timedelta(hours=sla_hours)

        resolved = None
        resolution_minutes = None
        if status in ("RESOLVED", "CLOSED"):
            resolved = rng.between(created, world.anchor)
            resolution_minutes = max(1, int((resolved - created).total_seconds() // 60))

        breached = (
            resolved > due if resolved is not None else world.anchor > due
        ) and status not in ("CLOSED",) or (resolved is not None and resolved > due)

        world.tickets.append(
            Ticket(
                id=rng.uuid(),
                reference=reference("TIC", index + 1),
                subject=rng.pick(catalog.TICKET_SUBJECTS),
                description=(
                    "Reported by the customer with screenshots attached. "
                    "Reproduced on the current release; workaround noted in the comments."
                ),
                status=status,
                priority=rng.weighted(catalog.PRIORITIES),
                severity=severity,
                category=rng.pick(catalog.TICKET_CATEGORIES),
                channel=rng.weighted(catalog.TICKET_CHANNELS),
                organization_id=organization.id,
                customer_id=rng.pick(customers).id if customers else None,
                project_id=rng.pick(projects).id if projects and rng.chance(0.4) else None,
                assignee_id=rng.pick(members).id if members and status != "OPEN" else None,
                reporter_id=rng.pick(members).id if members else None,
                due_at=due,
                first_response_at=rng.between(created, world.anchor) if rng.chance(0.85) else None,
                resolved_at=resolved,
                resolution_minutes=resolution_minutes,
                sla_breached=bool(breached),
                reopen_count=rng.weighted(((0, 0.82), (1, 0.12), (2, 0.05), (3, 0.01))),
                satisfaction=rng.maybe(rng.integer(1, 5), 0.45) if resolved else None,
                tags=rng.sample([t[0] for t in catalog.TAGS], rng.integer(0, 3)),
                created_at=created,
            )
        )


def _orders(world: World) -> None:
    from src.models.business import Order

    rng = world.rng.derive("orders")
    regions_by_code = {region.code: region for region in world.regions}
    customers_by_org: dict = {}
    for customer in world.customers:
        customers_by_org.setdefault(customer.organization_id, []).append(customer)
    departments_by_org: dict = {}
    for department in world.departments:
        departments_by_org.setdefault(department.organization_id, []).append(department)

    for index in range(world.scale.orders):
        organization = rng.pick(world.organizations)
        members = world.users_by_org.get(organization.id, [])
        customers = customers_by_org.get(organization.id, [])
        departments = departments_by_org.get(organization.id, [])
        status = rng.weighted(catalog.ORDER_STATUSES)

        placed = rng.recent(days=400)
        shipped = rng.between(placed, world.anchor) if status in ("SHIPPED", "DELIVERED") else None
        delivered = rng.between(shipped, world.anchor) if shipped and status == "DELIVERED" else None

        lines = []
        subtotal = 0.0
        for _ in range(rng.integer(1, 6)):
            name, unit_price, unit = rng.pick(catalog.PRODUCTS)
            quantity = rng.integer(1, 25)
            line_total = round(unit_price * quantity, 2)
            subtotal += line_total
            lines.append(
                {
                    "sku": f"SKU-{abs(hash(name)) % 90000 + 10000}",
                    "name": name,
                    "unit": unit,
                    "quantity": quantity,
                    "unit_price": unit_price,
                    "total": line_total,
                }
            )

        discount = round(subtotal * rng.decimal(0, 0.15), 2) if rng.chance(0.3) else 0.0
        tax = round((subtotal - discount) * 0.21, 2)
        shipping = rng.money(0, 400, step=25) if rng.chance(0.5) else 0.0

        world.orders.append(
            Order(
                id=rng.uuid(),
                reference=reference("ORD", index + 1),
                status=status,
                payment_status=(
                    "REFUNDED" if status == "REFUNDED" else rng.weighted(catalog.PAYMENT_STATUSES)
                ),
                fulfilment_status={
                    "DELIVERED": "DELIVERED", "SHIPPED": "SHIPPED",
                    "CANCELLED": "CANCELLED", "REFUNDED": "RETURNED",
                }.get(status, "PENDING"),
                channel=rng.pick(catalog.ORDER_CHANNELS),
                customer_id=rng.pick(customers).id if customers else None,
                organization_id=organization.id,
                owner_id=rng.pick(members).id if members else None,
                region_id=regions_by_code[rng.pick(catalog.LOCATIONS)[2]].id,
                department_id=rng.pick(departments).id if departments else None,
                placed_at=placed,
                shipped_at=shipped,
                delivered_at=delivered,
                subtotal=round(subtotal, 2),
                tax=tax,
                shipping=shipping,
                discount=discount,
                total=round(subtotal - discount + tax + shipping, 2),
                currency=rng.pick(catalog.ORDER_CURRENCIES),
                item_count=sum(line["quantity"] for line in lines),
                items=lines,
                notes=rng.maybe("Customer asked for consolidated invoicing.", 0.2),
                created_at=placed,
            )
        )


def _devices(world: World) -> None:
    from src.models.business import Device

    rng = world.rng.derive("devices")
    regions_by_code = {region.code: region for region in world.regions}
    projects_by_org: dict = {}
    for project in world.projects:
        projects_by_org.setdefault(project.organization_id, []).append(project)

    for index in range(world.scale.devices):
        organization = rng.pick(world.organizations)
        members = world.users_by_org.get(organization.id, [])
        projects = projects_by_org.get(organization.id, [])
        kind = rng.weighted(catalog.DEVICE_KINDS)
        status = rng.weighted(catalog.DEVICE_STATUSES)
        manufacturer = rng.pick(catalog.DEVICE_MANUFACTURERS)
        city, _country, region_code = rng.pick(catalog.LOCATIONS)

        world.devices.append(
            Device(
                id=rng.uuid(),
                serial=f"{manufacturer[:3].upper()}-{rng.integer(100000, 999999)}-{index:04d}",
                name=f"{kind.title()} {city} {index + 1:03d}",
                kind=kind,
                model=f"{manufacturer} {rng.pick(('X', 'S', 'Pro', 'Edge'))}{rng.integer(1, 9)}00",
                manufacturer=manufacturer,
                status=status,
                firmware=f"{rng.integer(1, 6)}.{rng.integer(0, 20)}.{rng.integer(0, 30)}",
                ip_address=f"10.{rng.integer(0, 255)}.{rng.integer(0, 255)}.{rng.integer(1, 254)}",
                location=f"{city} — {rng.pick(('Warehouse', 'Plant', 'Depot', 'Office', 'Substation'))} {rng.integer(1, 9)}",
                organization_id=organization.id,
                region_id=regions_by_code[region_code].id,
                owner_id=rng.pick(members).id if members and rng.chance(0.7) else None,
                project_id=rng.pick(projects).id if projects and rng.chance(0.5) else None,
                # An offline device that reported thirty seconds ago is a
                # contradiction; the timestamp has to follow the status.
                last_seen_at=(
                    rng.recent(days=1) if status == "ONLINE"
                    else rng.ago(days_min=1, days_max=90)
                ),
                battery_percent=rng.maybe(rng.integer(2, 100), 0.72),
                signal_strength=rng.maybe(rng.integer(-110, -40), 0.8),
                uptime_hours=rng.integer(0, 26_000),
                error_count=rng.weighted(((0, 0.55), (rng.integer(1, 9), 0.3), (rng.integer(10, 400), 0.15))),
                warranty_until=rng.maybe(rng.ahead(days_min=1, days_max=1_400), 0.8),
                tags=rng.sample([t[0] for t in catalog.TAGS], rng.integer(0, 2)),
                created_at=rng.ago(days_min=20, days_max=1_500),
                metadata_json={"firmware_channel": rng.pick(("stable", "beta"))},
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
                status=rng.weighted((("CONFIRMED", 0.8), ("TENTATIVE", 0.14), ("CANCELLED", 0.06))),
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
                        "response": rng.weighted(
                            (("ACCEPTED", 0.62), ("TENTATIVE", 0.16), ("DECLINED", 0.1), ("NEEDS_ACTION", 0.12))
                        ),
                    }
                    for person in attendees
                ] or None,
                recurrence=(
                    {
                        "freq": rng.pick(("DAILY", "WEEKLY", "MONTHLY")),
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
