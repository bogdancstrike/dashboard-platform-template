"""Seed data for business: build."""

from __future__ import annotations

from src.seed import catalog
from src.seed.business.calendar import _calendar, _projects
from src.seed.business.tasks import _tasks
from src.seed.business.tickets import _customers, _tickets
from src.seed.support import reference
from src.seed.world import World


def build(world: World) -> None:
    _customers(world)
    _projects(world)
    _tasks(world)
    _tickets(world)
    _orders(world)
    _devices(world)
    _calendar(world)


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
                created_at=rng.ago(days_min=20, days_max=1_500),
                metadata_json={"firmware_channel": rng.pick(("stable", "beta"))},
            )
        )
