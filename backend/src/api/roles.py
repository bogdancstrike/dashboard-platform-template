"""Roles and the permission matrix (§13).

Reads and writes the `roles` table, which `core/auth._permissions_for`
consults on every request — so a change here applies to the next request the
affected user makes, with no re-login and no cache to invalidate.
"""

from __future__ import annotations

from typing import Any

from src.core.auth import json_body, me, requires
from src.core.db import session_scope
from src.services import roles as service


@requires("roles.manage")
def collection(app=None, operation: str = "", request=None, **_: Any):
    """The roles in force, what each grants, and how many people hold it."""
    with session_scope() as session:
        return service.listing(session, principal=me()), 200


@requires("roles.manage")
def item(app=None, operation: str = "", request=None, code: str = "", **kwargs: Any):
    """Change what a role grants."""
    identifier = code or str(kwargs.get("code") or "")
    with session_scope() as session:
        return service.update(session, identifier, json_body(), principal=me()), 200
