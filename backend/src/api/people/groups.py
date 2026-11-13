"""Group endpoints (§11).

Three permissions across five endpoints, and the split is the whole design:

* `users.view` reads — a group's membership is directory information;
* `users.manage` creates, renames, removes and changes *who is in* a group;
* `roles.manage` changes what a group *grants*.

That last line is not bureaucracy. `core/auth/users.permissions_for` unions a
group's permissions onto its members' roles, so whoever may edit them may grant
any permission to anybody — including themselves. A manager holds
`users.manage` and not `roles.manage`; collapsing the two would quietly make
`users.manage` worth everything.
"""

from __future__ import annotations

from typing import Any

from src.api.handler import Call, endpoint
from src.core.auth import me, requires
from src.core.db import session_scope
from src.services.people import groups as service


@requires("users.view")
@endpoint
def catalogue(call: Call):
    """The kinds, the permission catalogue, and what this reader may change."""
    with session_scope() as session:
        return service.catalogue(session, principal=me()), 200


@requires("users.view")
def collection(app=None, operation: str = "", request=None, **_: Any):
    """Every group, filtered and faceted — or a new one."""
    args = request.args if request is not None else {}
    method = (request.method if request is not None else "GET").upper()
    with session_scope() as session:
        if method == "POST":
            payload = (request.get_json(silent=True) if request is not None else None) or {}
            return service.create(session, payload, principal=me()), 201
        return service.listing(session, args, principal=me()), 200


@requires("users.view")
@endpoint
def item(call: Call, group_id: str = ""):
    """One group and the people in it — read it, rename it, or retire it."""
    identifier = group_id
    method = call.method
    with session_scope() as session:
        if method == "PUT":
            payload = (call.loose_body) or {}
            return service.update(session, identifier, payload, principal=me()), 200
        if method == "DELETE":
            return service.remove(session, identifier, principal=me()), 200
        return service.entry(session, identifier, principal=me()), 200


@requires("users.view", "users.manage")
@endpoint
def members(call: Call, group_id: str = ""):
    """Set who is in a group (§11).

    The whole membership rather than a delta, so the request says what the
    group *is* — two administrators editing at once cannot interleave into a
    state neither of them chose. Effective on the members' next request, with
    no re-login: `permissions_for` reads the table every time.
    """
    identifier = group_id
    payload = (call.loose_body) or {}
    with session_scope() as session:
        return service.set_members(session, identifier, payload, principal=me()), 200


@requires("users.view", "roles.manage")
@endpoint
def grants(call: Call, group_id: str = ""):
    """Set what being in a group adds (§11, §13).

    `roles.manage`, not `users.manage`: this is granting permissions. See the
    module docstring for why the two cannot be the same privilege.
    """
    identifier = group_id
    payload = (call.loose_body) or {}
    with session_scope() as session:
        return service.set_grants(session, identifier, payload, principal=me()), 200
