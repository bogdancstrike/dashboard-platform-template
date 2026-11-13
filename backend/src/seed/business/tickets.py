"""Seed data for business: _customers, _tickets."""

from __future__ import annotations

from datetime import timedelta

from src.seed import catalog
from src.seed.support import reference, slugify
from src.seed.world import World


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
                created_at=rng.ago(days_min=30, days_max=1_800),
                metadata_json={"segment": segment, "stage": stage},
            )
        )


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
                created_at=created,
            )
        )
