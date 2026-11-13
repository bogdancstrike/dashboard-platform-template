"""Seed data for identity: _assign_managers."""

from __future__ import annotations

from src.seed.support import Rng
from src.seed.world import World


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
