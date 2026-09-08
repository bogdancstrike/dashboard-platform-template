"""Organization, department and team endpoints (§42).

`users.view` reads the structure — where somebody sits is directory
information. `orgs.manage` changes it.

The tree is one endpoint rather than three, because it is one question: an
organisation, its nested departments and the teams inside them. Fetching it in
pieces would mean the page assembling a structure the server already knows, and
a level appearing before its parent.

Departments carry a stored `headcount` that nothing here reads: it was drawn at
random before the users existed and said 116 for a department with nobody in
it. `services/organizations` counts `users.department_id` instead, and
`--sync-org` keeps the column from contradicting it.
"""

from __future__ import annotations

from typing import Any

from src.core.auth import me, requires
from src.core.db import session_scope
from src.services import organizations as service


@requires("users.view")
def catalogue(app=None, operation: str = "", request=None, **_: Any):
    """Tiers, statuses, regions, and what this reader may change."""
    with session_scope() as session:
        return service.catalogue(session, principal=me()), 200


@requires("users.view")
def collection(app=None, operation: str = "", request=None, **_: Any):
    """Every organisation, filtered and faceted in PostgreSQL."""
    args = request.args if request is not None else {}
    with session_scope() as session:
        return service.listing(session, args, principal=me()), 200


@requires("users.view")
def item(app=None, operation: str = "", request=None, organization_id: str = "", **kwargs: Any):
    """One organisation's whole structure — or a change to its own details."""
    identifier = organization_id or str(kwargs.get("organization_id") or "")
    method = (request.method if request is not None else "GET").upper()
    with session_scope() as session:
        if method == "PUT":
            payload = (request.get_json(silent=True) if request is not None else None) or {}
            return service.update(session, identifier, payload, principal=me()), 200
        return service.tree(session, identifier, principal=me()), 200


@requires("users.view", "orgs.manage")
def departments(
    app=None, operation: str = "", request=None, organization_id: str = "", **kwargs: Any
):
    """Add a department, optionally inside another (§42)."""
    identifier = organization_id or str(kwargs.get("organization_id") or "")
    payload = (request.get_json(silent=True) if request is not None else None) or {}
    with session_scope() as session:
        return service.create_department(session, identifier, payload, principal=me()), 201


@requires("users.view", "orgs.manage")
def department(
    app=None, operation: str = "", request=None, department_id: str = "", **kwargs: Any
):
    """Edit or move a department, or retire it (§42).

    A move is the one edit that can corrupt the structure — a department that
    became its own ancestor would make the tree infinite — so the cycle is
    refused with the offending path named. Retiring is refused while anything
    is still inside, because a department is a place and its foreign keys
    cascade.
    """
    identifier = department_id or str(kwargs.get("department_id") or "")
    method = (request.method if request is not None else "PUT").upper()
    with session_scope() as session:
        if method == "DELETE":
            return service.remove_department(session, identifier, principal=me()), 200
        payload = (request.get_json(silent=True) if request is not None else None) or {}
        return service.move_department(session, identifier, payload, principal=me()), 200
