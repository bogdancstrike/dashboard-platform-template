"""The calendar (§19).

Four endpoints. The collection is a *window*: `GET ?from=&to=` returns
occurrences, expanded from their series, rather than rows — which is why the
range is required rather than defaulted. A calendar endpoint that answered
"everything" would expand every series the database holds to draw one month.

`respond` is its own endpoint and needs only `calendar.view`, because answering
an invitation is not editing a calendar. It writes only the caller's own entry.
"""

from __future__ import annotations

from typing import Any

from src.api.handler import Call, endpoint
from src.core.auth import me, requires
from src.core.db import session_scope
from src.services.work import calendar as service


@requires("calendar.view")
@endpoint
def events(call: Call):
    """Everything in a window, or a new event."""
    principal = me()
    if call.method == "POST":
        with session_scope() as session:
            return (
                service.create(session, call.loose_body, principal=principal),
                201,
            )

    args = call.args
    with session_scope() as session:
        return service.window(session, args, principal=principal), 200


@requires("calendar.view")
@endpoint
def event(call: Call, event_id=None):
    """One event, a change to the whole series, or its cancellation."""
    principal = me()
    with session_scope() as session:
        if call.method == "PUT":
            return (
                service.update(
                    session, event_id, call.loose_body, principal=principal
                ),
                200,
            )
        if call.method == "DELETE":
            return service.remove(session, event_id, principal=principal), 200
        return service.get(session, event_id, principal=principal), 200


@requires("calendar.view")
def respond(app=None, operation: str = "", request=None, event_id=None, **_: Any):
    """Say whether you are coming."""
    principal = me()
    with session_scope() as session:
        return (
            service.respond(
                session, event_id, request.get_json(silent=True) if request else None,
                principal=principal,
            ),
            200,
        )
