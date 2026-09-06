"""User administration and impersonation (§12).

Impersonation is split deliberately. `core/auth` implements the *transport* —
an `X-Impersonate-User` header on an otherwise ordinary request, so the
administrator's own identity stays the one Keycloak proved and every audit row
carries both sides. This module owns the *authorization*: who may be
impersonated at all, answered once before the first impersonated request
rather than by letting every subsequent call fail.
"""

from __future__ import annotations

from typing import Any

from src.core.auth import json_body, me, requires
from src.core.db import session_scope
from src.services import users as service


@requires("users.view")
def collection(app=None, operation: str = "", request=None, **_: Any):
    """People, filtered and faceted in SQL like every other list."""
    args = request.args if request is not None else {}
    with session_scope() as session:
        return service.listing(session, args, principal=me()), 200


@requires("users.view")
def item(app=None, operation: str = "", request=None, user_id: str = "", **kwargs: Any):
    """One person: their profile, their effective access, and how they got it."""
    identifier = user_id or str(kwargs.get("user_id") or "")
    method = (request.method if request is not None else "GET").upper()

    with session_scope() as session:
        if method == "PUT":
            return service.update(session, identifier, json_body(), principal=me()), 200
        return service.detail(session, identifier, principal=me()), 200


@requires("users.impersonate")
def impersonate(app=None, operation: str = "", request=None, user_id: str = "", **kwargs: Any):
    """Begin acting as somebody else.

    Answers *whether* it is allowed and records that it started; the client
    then sends `X-Impersonate-User` on subsequent requests. Recorded at the
    start rather than only per action, because "an administrator viewed the
    platform as this person" is itself the event worth having.
    """
    identifier = user_id or str(kwargs.get("user_id") or "")
    with session_scope() as session:
        return service.impersonation_target(session, identifier, principal=me()), 200
