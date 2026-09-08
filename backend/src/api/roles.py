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
    """The roles in force, or a new one of this installation's own."""
    if request is not None and request.method == "POST":
        with session_scope() as session:
            return service.create(session, json_body(), principal=me()), 201
    with session_scope() as session:
        return service.listing(session, principal=me()), 200


@requires("roles.manage")
def item(app=None, operation: str = "", request=None, code: str = "", **kwargs: Any):
    """Change what a role grants, or remove one this installation added.

    A built-in role can be edited and never removed: the seed writes it and
    `--sync-roles` maintains it, so a deleted one would come back on the next
    deploy — and `_permissions_for` would be reading a row that vanished in
    between.
    """
    identifier = code or str(kwargs.get("code") or "")
    with session_scope() as session:
        if request is not None and request.method == "DELETE":
            return service.remove(session, identifier, principal=me()), 200
        return service.update(session, identifier, json_body(), principal=me()), 200
