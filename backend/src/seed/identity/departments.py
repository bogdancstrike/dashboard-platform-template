"""Seed data for identity: _login_events, _departments, _memberships."""

from __future__ import annotations

from src.core import vocabulary
from src.core.auth import device_of
from src.core.vocabulary import weighted
from src.seed import catalog
from src.seed.world import World


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
                # Filled in by `_settle_headcount` once the people exist. Drawn
                # at random here it said 116 for a department with nobody in
                # it, which is the platform contradicting its own directory.
                headcount=0,
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
                        headcount=0,
                        created_at=rng.between(parent.created_at, world.anchor),
                    )
                )


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
                result=vocabulary.LOGIN_RESULT[1] if failed else vocabulary.LOGIN_RESULT[0],
                reason=rng.pick(
                    ("Invalid credentials", "Account locked", "MFA challenge failed", "Expired password")
                ) if failed else None,
                ip_address=f"{rng.integer(10, 213)}.{rng.integer(0, 255)}.{rng.integer(0, 255)}.{rng.integer(1, 254)}",
                user_agent=agent,
                device=device_of(agent),
                location=rng.pick(catalog.LOCATIONS)[0],
                # Weights positionally against the vocabulary, so a method
                # added there has to be given a weight here rather than
                # silently never appearing.
                method=rng.weighted(weighted(vocabulary.LOGIN_METHOD, (0.62, 0.28, 0.1))),
                created_at=rng.past_business_hour(rng.recent(days=120)),
            )
        )
