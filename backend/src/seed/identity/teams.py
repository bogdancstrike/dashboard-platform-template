"""Seed data for identity: AVATAR_COLORS, PERSONAS, PERSONA_DOMAIN."""

from __future__ import annotations

from src.core.auth import ROLE_DEFAULTS
from src.seed import catalog
from src.seed.support import slugify
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


def _settle_headcount(world: World) -> None:
    """Make `departments.headcount` agree with the people in them.

    It was `rng.integer(3, 120)`, written before the users existed and never
    reconciled — so Support stored 116 while nobody at all was assigned to it.
    Two numbers for one fact, and the stored one was the fiction.

    `services/organizations` computes the count from `users.department_id`
    rather than reading this column, so the API cannot be wrong even if the
    column drifts again. This exists so the column is not a lie for anything
    that reads it directly, and so `--check` has something true to verify.

    A sub-department's people are its own. Rolling a parent's children into it
    would make the numbers on a tree sum to more than the organisation has,
    which is the other way round of the same problem.
    """
    from collections import Counter

    counted = Counter(
        user.department_id for user in world.users if user.department_id is not None
    )
    for department in world.departments:
        department.headcount = counted.get(department.id, 0)


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
