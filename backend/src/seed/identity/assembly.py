"""Seed data for identity: build."""

from __future__ import annotations

from src.seed.identity.departments import _departments, _login_events, _memberships
from src.seed.identity.organizations import _organizations, _regions, _sessions
from src.seed.identity.teams import (
    _groups,
    _roles,
    _security_events,
    _settle_headcount,
    _teams,
)
from src.seed.identity.users import _users
from src.seed.world import World


def build(world: World) -> None:
    _regions(world)
    _roles(world)
    _organizations(world)
    _departments(world)
    _teams(world)
    _groups(world)
    _users(world)
    _settle_headcount(world)
    _memberships(world)
    _sessions(world)
    _login_events(world)
    _security_events(world)
