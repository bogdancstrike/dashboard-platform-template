"""JWT-protected saved Data Explorer questions."""

from __future__ import annotations

from typing import Any

from src.core.auth import json_body, me, requires
from src.core.db import session_scope
from src.services import saved_searches as service


@requires("records.view")
def collection(app=None, operation: str = "", request=None, **_: Any):
    principal = me()
    with session_scope() as session:
        if request.method == "POST":
            return service.create(session, json_body(), principal=principal), 201
        return service.list_searches(session, request.args, principal=principal), 200


@requires("records.view")
def item(app=None, operation: str = "", request=None, search_id=None, **_: Any):
    principal = me()
    with session_scope() as session:
        if request.method == "PUT":
            return service.update(session, search_id, json_body(), principal=principal), 200
        if request.method == "DELETE":
            service.remove(session, search_id, principal=principal)
            return None, 204
        return service.get(session, search_id, principal=principal, mark_used=True), 200


@requires("records.view")
def duplicate(app=None, operation: str = "", request=None, search_id=None, **_: Any):
    with session_scope() as session:
        return service.duplicate(session, search_id, principal=me()), 201
