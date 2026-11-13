"""Seed data for identity: _sessions, _regions, _organizations."""

from __future__ import annotations

from src.core.auth import device_of
from src.seed import catalog
from src.seed.identity.teams import LOCALES
from src.seed.support import slugify
from src.seed.world import World


def _regions(world: World) -> None:
    from src.models.identity import Region

    rng = world.rng.derive("regions")
    for name, code, timezone, currency in catalog.REGIONS:
        world.regions.append(
            Region(id=rng.uuid(), name=name, code=code, timezone=timezone, currency=currency)
        )


def _organizations(world: World) -> None:
    from src.models.identity import Organization

    rng = world.rng.derive("organizations")
    regions_by_code = {region.code: region for region in world.regions}
    used: set[str] = set()

    for index in range(world.scale.organizations):
        root = catalog.ORG_ROOTS[index % len(catalog.ORG_ROOTS)]
        suffix = rng.pick(catalog.ORG_SUFFIXES)
        name = f"{root} {suffix}"
        slug = slugify(name)
        while slug in used:  # two roots can collide once the list wraps
            suffix = rng.pick(catalog.ORG_SUFFIXES)
            name = f"{root} {suffix}"
            slug = slugify(f"{name}-{index}")
        used.add(slug)

        city, country, region_code = rng.pick(catalog.LOCATIONS)
        tier = rng.weighted(catalog.ORG_TIERS)
        employees = {
            "ENTERPRISE": rng.integer(2_000, 40_000),
            "STANDARD": rng.integer(200, 2_000),
            "STARTER": rng.integer(20, 200),
            "TRIAL": rng.integer(3, 40),
        }[tier]

        world.organizations.append(
            Organization(
                id=rng.uuid(),
                name=name,
                slug=slug,
                legal_name=f"{name} B.V." if country == "Netherlands" else f"{name} Ltd.",
                industry=rng.pick(catalog.INDUSTRIES),
                tier=tier,
                status=rng.weighted((("ACTIVE", 0.88), ("SUSPENDED", 0.06), ("ARCHIVED", 0.06))),
                region_id=regions_by_code[region_code].id,
                website=f"https://www.{slug}.example",
                email=f"contact@{slug}.example",
                phone=f"+{rng.integer(30, 49)} {rng.integer(10, 99)} {rng.integer(1000000, 9999999)}",
                address_line=f"{rng.integer(1, 240)} {rng.pick(('Main', 'Market', 'Station', 'Harbour', 'Park'))} Street",
                city=city,
                country=country,
                employee_count=employees,
                annual_revenue=rng.money(500_000, 400_000_000, step=50_000),
                created_at=rng.ago(days_min=180, days_max=2_200),
                settings={
                    "security": {
                        "mfa_required": rng.chance(0.35),
                        "session_timeout_minutes": rng.pick((30, 60, 120, 480)),
                        "ip_allowlist": [],
                    },
                    "retention": {
                        "audit_days": rng.pick((365, 730, 1095)),
                        "log_days": rng.pick((14, 30, 90)),
                    },
                    "defaults": {
                        "locale": rng.pick(LOCALES),
                        "timezone": regions_by_code[region_code].timezone,
                        "currency": regions_by_code[region_code].currency,
                        "density": rng.pick(("compact", "middle", "comfortable")),
                    },
                },
                metadata_json={"crm_id": f"CRM-{rng.integer(10_000, 99_999)}", "tier": tier},
            )
        )


def _sessions(world: World) -> None:
    """Sign-ins, at most one of them current per person (§41).

    `is_current=index < 5` was the first version and marked the first five
    sessions of *every* user as current — so somebody with three sessions had
    three of them each claiming to be the one they were reading the page from,
    which is not a thing "current" can mean. It is now the most recently seen
    live session of each person, decided after the draw rather than during it.
    """
    from src.models.identity import UserSession

    rng = world.rng.derive("sessions")
    active = [u for u in world.users if u.status == "ACTIVE"]
    if not active:
        return

    made: list[UserSession] = []
    for index in range(world.scale.sessions):
        user = rng.pick(active)
        agent = rng.pick(catalog.USER_AGENTS)
        started = rng.recent(days=20)
        revoked = rng.chance(0.12)
        made.append(
            UserSession(
                id=rng.uuid(),
                user_id=user.id,
                token_id=f"sid-{rng.uuid().hex[:24]}-{index}",
                ip_address=f"{rng.integer(10, 213)}.{rng.integer(0, 255)}.{rng.integer(0, 255)}.{rng.integer(1, 254)}",
                user_agent=agent,
                device=device_of(agent),
                location=f"{rng.pick(catalog.LOCATIONS)[0]}",
                # Decided below, once every session exists.
                is_current=False,
                trusted=rng.chance(0.6),
                revoked_at=rng.between(started, world.anchor) if revoked else None,
                last_seen_at=rng.between(started, world.anchor),
                expires_at=rng.ahead(days_min=1, days_max=14),
                created_at=started,
            )
        )

    # One per person, and only a live one: a revoked session cannot be the one
    # somebody is using, and neither can an expired one.
    by_user: dict[object, UserSession] = {}
    for row in made:
        if row.revoked_at is not None or (row.expires_at and row.expires_at <= world.anchor):
            continue
        held = by_user.get(row.user_id)
        if held is None or (row.last_seen_at or row.created_at) > (
            held.last_seen_at or held.created_at
        ):
            by_user[row.user_id] = row
    for row in by_user.values():
        row.is_current = True

    world.sessions.extend(made)
