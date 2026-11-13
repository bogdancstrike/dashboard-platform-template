"""Roles and the permission matrix (§13).

Reads and writes the `roles` table, which `core/auth/users.permissions_for`
consults on every request — so a change here applies to the next request the
affected user makes, with no re-login and no cache to invalidate.
"""

from __future__ import annotations

from src.api.handler import Call, endpoint
from src.core.auth import me, requires
from src.core.db import session_scope
from src.services.people import roles as service


@requires("roles.manage")
@endpoint
def collection(call: Call):
    """The roles in force, or a new one of this installation's own."""
    if call.method == "POST":
        with session_scope() as session:
            return service.create(session, call.body, principal=me()), 201
    with session_scope() as session:
        return service.listing(session, principal=me()), 200


@requires("roles.manage")
@endpoint
def item(call: Call, code: str = ""):
    """Change what a role grants, or remove one this installation added.

    A built-in role can be edited and never removed: the seed writes it and
    `--sync-roles` maintains it, so a deleted one would come back on the next
    deploy — and `permissions_for` would be reading a row that vanished in
    between.
    """
    identifier = code
    with session_scope() as session:
        if call.method == "DELETE":
            return service.remove(session, identifier, principal=me()), 200
        return service.update(session, identifier, call.body, principal=me()), 200
