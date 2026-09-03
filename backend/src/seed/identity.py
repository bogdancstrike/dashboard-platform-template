"""Regions, roles, organizations, the org tree, and the people in it.

Everything else references a user or an organization, so this runs first and
the rest of the seed reads its output from the `World`.

The five realm personas (`admin@nucleus.example` and friends) are created here
with the emails Keycloak carries. `core/auth.py` matches an incoming token to a
local profile by external subject, then by email — so a reviewer who signs in
as `admin` adopts the seeded profile instead of provisioning an empty one, and
lands on a populated application rather than an empty one.
"""

from __future__ import annotations

from src.core.auth import ROLE_DEFAULTS
from src.seed import catalog
from src.seed.support import Rng, avatar_data_uri, slugify
from src.seed.world import World

#: Colours the initials avatars cycle through.
AVATAR_COLORS = (
    "#5b5bd6", "#0891b2", "#16a34a", "#ca8a04", "#dc2626",
    "#7c3aed", "#db2777", "#0d9488", "#ea580c", "#475569",
)

#: (username, first, last, role code) — must match keycloak/realm-template.json.
PERSONAS: tuple[tuple[str, str, str, str], ...] = (
    ("admin", "Ada", "Administrator", "ADMINISTRATOR"),
    ("manager", "Mara", "Manager", "MANAGER"),
    ("operator", "Otto", "Operator", "OPERATOR"),
    ("analyst", "Ana", "Analyst", "ANALYST"),
    ("user", "Uma", "User", "VIEWER"),
)
PERSONA_DOMAIN = "nucleus.example"

USER_STATUSES: tuple[tuple[str, float], ...] = (
    ("ACTIVE", 0.86), ("INVITED", 0.05), ("SUSPENDED", 0.04),
    ("INACTIVE", 0.04), ("LOCKED", 0.01),
)

LOCALES = ("en-US", "en-GB", "ro-RO", "de-DE", "fr-FR", "nl-NL", "sv-SE")


def build(world: World) -> None:
    _regions(world)
    _roles(world)
    _organizations(world)
    _departments(world)
    _teams(world)
    _groups(world)
    _users(world)
    _memberships(world)
    _sessions(world)
    _login_events(world)
    _security_events(world)


# ── reference data ───────────────────────────────────────────────────────


def _regions(world: World) -> None:
    from src.models.identity import Region

    rng = world.rng.derive("regions")
    for name, code, timezone, currency in catalog.REGIONS:
        world.regions.append(
            Region(id=rng.uuid(), name=name, code=code, timezone=timezone, currency=currency)
        )


def _roles(world: World) -> None:
    """The permission bundles `core/auth.py` resolves against.

    Written from `ROLE_DEFAULTS` rather than restated here: the catalogue in
    code and the rows in the database must agree, and the way to guarantee that
    is to have one of them come from the other.
    """
    from src.models.identity import Role

    rng = world.rng.derive("roles")
    for code, definition in ROLE_DEFAULTS.items():
        world.roles.append(
            Role(
                id=rng.uuid(),
                code=code,
                name=definition["name"],
                description=definition["description"],
                permissions=list(definition["permissions"]),
                rank=definition["rank"],
                color=definition["color"],
                is_system=True,
                is_default=(code == "VIEWER"),
            )
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


def _departments(world: World) -> None:
    """A two-level tree: top-level departments, with sub-departments under some.

    Parents are appended before children so the rows insert in an order
    PostgreSQL accepts without deferring the self-referencing foreign key.
    """
    from src.models.identity import Department

    rng = world.rng.derive("departments")
    low, high = world.scale.departments_per_org

    for organization in world.organizations:
        chosen = rng.sample(catalog.DEPARTMENTS, rng.integer(low, high))
        for name, code in chosen:
            parent = Department(
                id=rng.uuid(),
                name=name,
                code=code,
                description=f"{name} at {organization.name}.",
                organization_id=organization.id,
                cost_center=f"CC-{code}-{rng.integer(100, 999)}",
                headcount=rng.integer(3, 120),
                created_at=rng.between(organization.created_at, world.anchor),
            )
            world.departments.append(parent)

            for child_name in catalog.SUB_DEPARTMENTS.get(name, ())[: rng.integer(0, 3)]:
                world.departments.append(
                    Department(
                        id=rng.uuid(),
                        name=f"{name} — {child_name}",
                        code=f"{code}-{child_name[:3].upper()}",
                        description=f"{child_name} within {name}.",
                        organization_id=organization.id,
                        parent_id=parent.id,
                        cost_center=f"CC-{code}-{rng.integer(100, 999)}",
                        headcount=rng.integer(2, 40),
                        created_at=rng.between(parent.created_at, world.anchor),
                    )
                )


def _teams(world: World) -> None:
    from src.models.identity import Team

    rng = world.rng.derive("teams")
    low, high = world.scale.teams_per_org
    departments_by_org: dict = {}
    for department in world.departments:
        departments_by_org.setdefault(department.organization_id, []).append(department)

    for organization in world.organizations:
        departments = departments_by_org.get(organization.id, [])
        for name in rng.sample(catalog.TEAM_NAMES, rng.integer(low, high)):
            department = rng.pick(departments) if departments else None
            world.teams.append(
                Team(
                    id=rng.uuid(),
                    name=f"Team {name}",
                    slug=slugify(f"{organization.slug}-{name}"),
                    description=f"{name} squad.",
                    organization_id=organization.id,
                    department_id=department.id if department else None,
                    color=rng.pick(AVATAR_COLORS),
                    created_at=rng.between(organization.created_at, world.anchor),
                )
            )


def _groups(world: World) -> None:
    from src.models.identity import Group

    rng = world.rng.derive("groups")
    for name, kind, permissions in catalog.GROUPS:
        world.groups.append(
            Group(
                id=rng.uuid(),
                name=name,
                slug=slugify(name),
                description=f"{name} — additive permissions on top of the member's role.",
                kind=kind,
                permissions=list(permissions),
                organization_id=world.organizations[0].id if world.organizations else None,
                color=rng.pick(AVATAR_COLORS),
                created_at=rng.ago(days_min=60, days_max=900),
            )
        )


# ── people ───────────────────────────────────────────────────────────────


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
                    "sidebar_collapsed": rng.chance(0.25),
                },
                "formats": {
                    "date": rng.pick(("YYYY-MM-DD", "DD/MM/YYYY", "MM/DD/YYYY")),
                    "time": rng.pick(("24h", "12h")),
                    "number": rng.pick(("1 234,56", "1,234.56")),
                },
                "defaults": {
                    "page_size": rng.pick((10, 25, 50, 100)),
                    "landing_page": rng.pick(("dashboard", "tasks", "inbox", "projects")),
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


def _assign_managers(world: World, rng: Rng) -> None:
    """Point people at a manager in their own organization, and never at
    themselves — a self-managing user makes the org chart recurse forever."""
    for organization_id, members in world.users_by_org.items():
        if len(members) < 3:
            continue
        # The most senior handful are the candidates; everyone else reports up.
        candidates = [u for u in members if u.role_id in {
            role.id for role in world.roles if role.rank >= 80
        }] or members[:2]
        for user in members:
            if user in candidates:
                continue
            if rng.chance(0.9):
                manager = rng.pick(candidates)
                if manager.id != user.id:
                    user.manager_id = manager.id

    # Departments and teams get their lead from the same pool.
    users_by_org = world.users_by_org
    for department in world.departments:
        members = users_by_org.get(department.organization_id, [])
        if members and rng.chance(0.85):
            department.manager_id = rng.pick(members).id
    for team in world.teams:
        members = users_by_org.get(team.organization_id, [])
        if members and rng.chance(0.9):
            team.lead_id = rng.pick(members).id


def _memberships(world: World) -> None:
    """Put people in groups, and make sure the personas are in the ones that
    demonstrate additive permissions."""
    rng = world.rng.derive("memberships")
    if not world.groups:
        return

    for user in world.users:
        for group in rng.sample(world.groups, rng.weighted(((0, 0.55), (1, 0.28), (2, 0.12), (3, 0.05)))):
            group.members.append(user)

    on_call = next((g for g in world.groups if g.name == "On-call"), None)
    stewards = next((g for g in world.groups if g.name == "Data stewards"), None)
    operator = world.personas.get("OPERATOR")
    analyst = world.personas.get("ANALYST")
    if on_call is not None and operator is not None and operator not in on_call.members:
        on_call.members.append(operator)
    if stewards is not None and analyst is not None and analyst not in stewards.members:
        stewards.members.append(analyst)


# ── sessions and security history ────────────────────────────────────────


def _sessions(world: World) -> None:
    from src.models.identity import UserSession

    rng = world.rng.derive("sessions")
    active = [u for u in world.users if u.status == "ACTIVE"]
    if not active:
        return

    for index in range(world.scale.sessions):
        user = rng.pick(active)
        agent = rng.pick(catalog.USER_AGENTS)
        started = rng.recent(days=20)
        revoked = rng.chance(0.12)
        world.sessions.append(
            UserSession(
                id=rng.uuid(),
                user_id=user.id,
                token_id=f"sid-{rng.uuid().hex[:24]}-{index}",
                ip_address=f"{rng.integer(10, 213)}.{rng.integer(0, 255)}.{rng.integer(0, 255)}.{rng.integer(1, 254)}",
                user_agent=agent,
                device=_device_of(agent),
                location=f"{rng.pick(catalog.LOCATIONS)[0]}",
                is_current=index < 5,
                trusted=rng.chance(0.6),
                revoked_at=rng.between(started, world.anchor) if revoked else None,
                last_seen_at=rng.between(started, world.anchor),
                expires_at=rng.ahead(days_min=1, days_max=14),
                created_at=started,
            )
        )


def _device_of(agent: str) -> str:
    lowered = agent.lower()
    if "iphone" in lowered or "android" in lowered:
        return "Mobile"
    if "ipad" in lowered:
        return "Tablet"
    for name, label in (("edg", "Edge"), ("chrome", "Chrome"), ("firefox", "Firefox"), ("safari", "Safari")):
        if name in lowered:
            return label
    return "Unknown"


def _login_events(world: World) -> None:
    from src.models.identity import LoginEvent

    rng = world.rng.derive("logins")
    for _ in range(world.scale.login_events):
        user = rng.pick(world.users)
        failed = rng.chance(0.13)
        agent = rng.pick(catalog.USER_AGENTS)
        world.login_events.append(
            LoginEvent(
                id=rng.uuid(),
                user_id=user.id,
                email=user.email,
                result="FAILURE" if failed else "SUCCESS",
                reason=rng.pick(
                    ("Invalid credentials", "Account locked", "MFA challenge failed", "Expired password")
                ) if failed else None,
                ip_address=f"{rng.integer(10, 213)}.{rng.integer(0, 255)}.{rng.integer(0, 255)}.{rng.integer(1, 254)}",
                user_agent=agent,
                device=_device_of(agent),
                location=rng.pick(catalog.LOCATIONS)[0],
                method=rng.weighted((("PASSWORD", 0.62), ("SSO", 0.28), ("MFA", 0.1))),
                created_at=rng.business_hour(rng.recent(days=120)),
            )
        )


def _security_events(world: World) -> None:
    from src.models.identity import SecurityEvent

    rng = world.rng.derive("security")
    for _ in range(world.scale.security_events):
        user = rng.pick(world.users)
        kind, severity, title = rng.pick(catalog.SECURITY_EVENT_KINDS)
        world.security_events.append(
            SecurityEvent(
                id=rng.uuid(),
                user_id=user.id,
                kind=kind,
                severity=severity,
                title=title,
                description=f"{title} for {user.full_name} ({user.email}).",
                ip_address=f"{rng.integer(10, 213)}.{rng.integer(0, 255)}.{rng.integer(0, 255)}.{rng.integer(1, 254)}",
                # Critical events are the ones most likely still open, which is
                # what makes the alert strip on the dashboard non-empty.
                resolved=rng.chance(0.3 if severity == "CRITICAL" else 0.78),
                created_at=rng.recent(days=150),
                metadata_json={"source": rng.pick(("keycloak", "platform", "gateway"))},
            )
        )
