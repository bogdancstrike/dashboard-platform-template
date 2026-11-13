"""The developer portal (§31): the API reference, captured examples, usage per client."""

from __future__ import annotations

from typing import Any

from src.core.auth import authenticated, me, requires
from src.core.db import session_scope
from src.services import developer_portal as service


@authenticated
def reference(app=None, operation: str = "", request=None, **_: Any):
    """Every endpoint, grouped, with who may call it and a real example where one is captured."""
    with session_scope() as session:
        return service.reference(session, principal=me()), 200


@requires("api.manage")
def examples(app=None, operation: str = "", request=None, **_: Any):
    """Keep a successful try-it call as that route's example."""
    with session_scope() as session:
        return service.capture(session, request.get_json(silent=True) if request else None, principal=me()), 201


@requires("api.manage")
def usage(app=None, operation: str = "", request=None, **_: Any):
    """Requests, errors, latency and busiest routes over a window — overall or per API client."""
    args = request.args.to_dict() if request is not None else {}
    with session_scope() as session:
        return service.usage(session, args, principal=me()), 200
