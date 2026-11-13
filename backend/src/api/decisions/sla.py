"""SLA policies and business calendars (Time & decisions).

Reading is `records.view` — a support agent should be able to see the promise
a ticket is measured against. Writing is `sla.manage`, checked in the service.
"""

from __future__ import annotations

from typing import Any

from src.api.handler import Call, endpoint
from src.core.auth import authenticated, json_body, me
from src.core.db import session_scope
from src.services.decisions import sla as service


def _method(request, default: str = "GET") -> str:
    return (request.method if request is not None else default).upper()


@authenticated
@endpoint
def catalogue(call: Call):
    """Priorities, categories, channels, segments, time zones and customers to choose from."""
    with session_scope() as session:
        return service.catalogue(session, principal=me()), 200


@authenticated
def policies(app=None, operation: str = "", request=None, **_: Any):
    """GET every policy in evaluation order with coverage; POST a new one."""
    with session_scope() as session:
        if _method(request) == "POST":
            return service.save_policy(session, json_body(), principal=me()), 201
        return service.policies(session, principal=me()), 200


@authenticated
def policy(app=None, operation: str = "", request=None, **kwargs: Any):
    """GET, PUT or DELETE one policy; a save recomputes every ticket's clock."""
    ident = str(kwargs.get("policy_id") or "")
    method = _method(request)
    with session_scope() as session:
        if method == "PUT":
            return service.save_policy(session, json_body(), principal=me(), ident=ident), 200
        if method == "DELETE":
            return service.delete_policy(session, ident, principal=me()), 200
        return service.policy(session, ident, principal=me()), 200


@authenticated
@endpoint
def order(call: Call):
    """Set the order policies are evaluated in."""
    with session_scope() as session:
        return service.reorder(session, call.body, principal=me()), 200


@authenticated
@endpoint
def calendars(call: Call):
    """POST a new business-hours calendar."""
    with session_scope() as session:
        return service.save_calendar(session, call.body, principal=me()), 201


@authenticated
def calendar(app=None, operation: str = "", request=None, **kwargs: Any):
    """PUT or DELETE one calendar."""
    ident = str(kwargs.get("calendar_id") or "")
    with session_scope() as session:
        if _method(request, "PUT") == "DELETE":
            return service.delete_calendar(session, ident, principal=me()), 200
        return service.save_calendar(session, json_body(), principal=me(), ident=ident), 200


@authenticated
@endpoint
def apply(call: Call):
    """Recompute every ticket's clock and fire due escalations."""
    with session_scope() as session:
        return service.apply_now(session, principal=me()), 200


@authenticated
def ticket(app=None, operation: str = "", request=None, **kwargs: Any):
    """The policy a ticket is measured against and its time left in business hours."""
    with session_scope() as session:
        return service.for_ticket(session, str(kwargs.get("ticket_id") or ""), principal=me()), 200
