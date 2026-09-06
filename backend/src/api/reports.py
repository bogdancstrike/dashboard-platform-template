"""Saved reports (§28).

A report is a saved analysis, so running one goes through the same compiler
the analytics workspace uses rather than a second implementation. Sharing is
`core/sharing`, the model saved searches already use.
"""

from __future__ import annotations

from typing import Any

from src.core.auth import json_body, me, requires
from src.core.db import session_scope
from src.services import reports as service


@requires("reports.view")
def collection(app=None, operation: str = "", request=None, **_: Any):
    """The reports this reader may open, or one more of their own."""
    method = (request.method if request is not None else "GET").upper()
    with session_scope() as session:
        if method == "POST":
            return service.create(session, json_body(), principal=me()), 201
        args = request.args if request is not None else {}
        return service.listing(session, args, principal=me()), 200


@requires("reports.view")
def item(app=None, operation: str = "", request=None, report_id: str = "", **kwargs: Any):
    """One report: read it, change it, or remove it. Only the owner writes."""
    identifier = report_id or str(kwargs.get("report_id") or "")
    method = (request.method if request is not None else "GET").upper()

    with session_scope() as session:
        if method == "PUT":
            return service.update(session, identifier, json_body(), principal=me()), 200
        if method == "DELETE":
            service.remove(session, identifier, principal=me())
            # `str`, because the route converter hands back a `UUID` and the
            # JSON encoder does not know one — which is a 500 *after* the
            # delete has already committed.
            return {"deleted": True, "id": str(identifier)}, 200
        return service.get(session, identifier, principal=me()), 200


@requires("reports.view")
def run(app=None, operation: str = "", request=None, report_id: str = "", **kwargs: Any):
    """Execute a saved report, optionally over a different period."""
    identifier = report_id or str(kwargs.get("report_id") or "")
    overrides = json_body() if (request is not None and request.data) else {}
    with session_scope() as session:
        return service.run(session, identifier, overrides, principal=me()), 200


@requires("reports.manage")
def duplicate(app=None, operation: str = "", request=None, report_id: str = "", **kwargs: Any):
    """A copy of somebody else's report, owned by the caller and private."""
    identifier = report_id or str(kwargs.get("report_id") or "")
    with session_scope() as session:
        return service.duplicate(session, identifier, principal=me()), 201
