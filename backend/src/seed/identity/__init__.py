"""Regions, roles, organizations, the org tree, and the people in it."""

from __future__ import annotations

from src.core.facade import lazy

__getattr__, __dir__, __all__ = lazy(__name__, {
    "teams": (
        "AVATAR_COLORS", "PERSONAS", "PERSONA_DOMAIN", "USER_STATUSES", "LOCALES",
        "_settle_headcount", "_roles", "_teams", "_groups", "_security_events",
    ),
    "departments": ("_departments", "_memberships", "_login_events"),
    "organizations": ("_regions", "_organizations", "_sessions"),
    "assign_managers": ("_assign_managers",),
    "users": ("_users",),
    "assembly": ("build",),
})
