"""Seed data for identity: _users."""

from __future__ import annotations

from src.seed import catalog
from src.seed.identity.assign_managers import _assign_managers
from src.seed.identity.teams import (
    AVATAR_COLORS,
    LOCALES,
    PERSONA_DOMAIN,
    PERSONAS,
    USER_STATUSES,
)
from src.seed.support import avatar_data_uri, slugify
from src.seed.world import World


def _users(world: World) -> None:
    """The personas first, then everybody else.

    Managers are assigned in a second pass: `users.manager_id` points at this
    same table, and a row whose manager has not been inserted yet is a foreign
    key violation, not a warning.
    """
    from src.models.identity import User

    rng = world.rng.derive("users")
    roles_by_code = {role.code: role for role in world.roles}
    departments_by_org: dict = {}
    teams_by_org: dict = {}
    for department in world.departments:
        departments_by_org.setdefault(department.organization_id, []).append(department)
    for team in world.teams:
        teams_by_org.setdefault(team.organization_id, []).append(team)

    #: The personas live in the first organization, which is therefore the one
    #: with the richest data — that is the org a reviewer will actually look at.
    home = world.organizations[0]
    home_departments = departments_by_org.get(home.id, [])
    home_teams = teams_by_org.get(home.id, [])
    emails: set[str] = set()

    def _add(
        *,
        username: str,
        first: str,
        last: str,
        email: str,
        role_code: str,
        organization,
        departments,
        teams,
        status: str = "ACTIVE",
    ) -> User:
        full_name = f"{first} {last}"
        department = rng.pick(departments) if departments else None
        team = rng.pick(teams) if teams else None
        titles = catalog.JOB_TITLES.get(
            (department.name.split(" — ")[0] if department else "Operations"),
            catalog.JOB_TITLES["Operations"],
        )
        created = rng.between(organization.created_at, world.anchor)
        user = User(
            id=rng.uuid(),
            email=email,
            username=username,
            full_name=full_name,
            first_name=first,
            last_name=last,
            avatar_url=avatar_data_uri(full_name, rng.pick(AVATAR_COLORS)),
            phone=rng.maybe(f"+{rng.integer(30, 49)} {rng.integer(600, 799)} {rng.integer(100000, 999999)}", 0.75),
            job_title=rng.pick(titles),
            organization_id=organization.id,
            department_id=department.id if department else None,
            team_id=team.id if team else None,
            role_id=roles_by_code[role_code].id,
            status=status,
            locale=rng.pick(LOCALES),
            timezone=rng.pick([r.timezone for r in world.regions]),
            last_login_at=rng.recent(days=45) if status == "ACTIVE" else None,
            login_count=rng.integer(1, 900) if status == "ACTIVE" else 0,
            mfa_enabled=rng.chance(0.42),
            mfa_method=rng.pick(("TOTP", "WEBAUTHN", "SMS")) if rng.chance(0.42) else None,
            # Deliberately imperfect: §65's data-quality indicators need
            # something real to indicate.
            profile_completeness=rng.weighted(
                ((100, 0.45), (85, 0.2), (70, 0.15), (55, 0.12), (40, 0.08))
            ),
            created_at=created,
            preferences={
                "appearance": {
                    "theme": rng.pick(("light", "dark", "system")),
                    "density": rng.pick(("compact", "middle", "comfortable")),
                    # Never seeded collapsed: a demo persona who signs in to a
                    # rail of unlabelled icons reads it as the navigation being
                    # broken, not as a preference somebody set for them.
                    "sidebar_collapsed": False,
                },
                "formats": {
                    "date": rng.pick(("YYYY-MM-DD", "DD/MM/YYYY", "MM/DD/YYYY")),
                    "time": rng.pick(("24h", "12h")),
                    "number": rng.pick(("1 234,56", "1,234.56")),
                },
                "defaults": {
                    "page_size": rng.pick((10, 25, 50, 100)),
                    # `home` included, and first: it is the platform's own
                    # default now, so a seeded population where nobody has it
                    # would be a population that never exercises the page
                    # everybody actually arrives on.
                    "landing_page": rng.pick(
                        ("home", "dashboard", "tasks", "inbox", "projects")
                    ),
                },
            },
        )
        emails.add(email)
        world.users.append(user)
        return user

    for username, first, last, role_code in PERSONAS:
        persona = _add(
            username=username,
            first=first,
            last=last,
            email=f"{username}@{PERSONA_DOMAIN}",
            role_code=role_code,
            organization=home,
            departments=home_departments,
            teams=home_teams,
        )
        # Personas are the accounts a reviewer signs in as, so they get a
        # complete profile — an empty one would look like a bug on first login.
        persona.profile_completeness = 100
        persona.mfa_enabled = role_code in ("ADMINISTRATOR", "MANAGER")
        persona.mfa_method = "TOTP" if persona.mfa_enabled else None
        persona.last_login_at = world.rng.recent(days=2)
        world.personas[role_code] = persona

    #: Role mix of a real company: mostly viewers and operators, few admins.
    role_mix: tuple[tuple[str, float], ...] = (
        ("VIEWER", 0.34), ("OPERATOR", 0.3), ("ANALYST", 0.16),
        ("MANAGER", 0.15), ("ADMINISTRATOR", 0.05),
    )

    while len(world.users) < world.scale.users:
        first = rng.pick(catalog.FIRST_NAMES)
        last = rng.pick(catalog.LAST_NAMES)
        organization = rng.pick(world.organizations)
        base = f"{slugify(first)}.{slugify(last)}"
        email = f"{base}@{organization.slug}.example"
        if email in emails:
            email = f"{base}{len(world.users)}@{organization.slug}.example"
        _add(
            username=email.split("@")[0] + f".{organization.slug[:6]}",
            first=first,
            last=last,
            email=email,
            role_code=rng.weighted(role_mix),
            organization=organization,
            departments=departments_by_org.get(organization.id, []),
            teams=teams_by_org.get(organization.id, []),
            status=rng.weighted(USER_STATUSES),
        )

    for user in world.users:
        world.users_by_org.setdefault(user.organization_id, []).append(user)

    _assign_managers(world, rng)
