"""JWT-protected saved Data Explorer questions."""

from __future__ import annotations

from typing import Any

from src.api.handler import Call, endpoint
from src.core.auth import json_body, me, requires
from src.core.db import session_scope
from src.services.records import saved_searches as service


@requires("records.view")
def collection(app=None, operation: str = "", request=None, **_: Any):
    principal = me()
    with session_scope() as session:
        if request.method == "POST":
            return service.create(session, json_body(), principal=principal), 201
        return service.list_searches(session, request.args, principal=principal), 200


@requires("records.view")
@endpoint
def item(call: Call, search_id=None):
    principal = me()
    with session_scope() as session:
        if call.method == "PUT":
            return service.update(session, search_id, call.body, principal=principal), 200
        if call.method == "DELETE":
            service.remove(session, search_id, principal=principal)
            return None, 204
        return service.get(session, search_id, principal=principal, mark_used=True), 200


@requires("records.view")
@endpoint
def duplicate(call: Call, search_id=None):
    with session_scope() as session:
        return service.duplicate(session, search_id, principal=me()), 201


@requires("records.view")
@endpoint
def transfer(call: Call, search_id=None):
    """Hand ownership to somebody else — owner-only, and audited (§5, §21)."""
    with session_scope() as session:
        return service.transfer(session, search_id, call.body, principal=me()), 200
