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

from src.core.auth import me, requires
from src.core.db import session_scope
from src.services import calendar as service


@requires("calendar.view")
def events(app=None, operation: str = "", request=None, **_: Any):
    """Everything in a window, or a new event."""
    principal = me()
    if request is not None and request.method == "POST":
        with session_scope() as session:
            return (
                service.create(session, request.get_json(silent=True), principal=principal),
                201,
            )

    args = request.args.to_dict() if request is not None else {}
    with session_scope() as session:
        return service.window(session, args, principal=principal), 200


@requires("calendar.view")
def event(app=None, operation: str = "", request=None, event_id=None, **_: Any):
    """One event, a change to the whole series, or its cancellation."""
    principal = me()
    with session_scope() as session:
        if request is not None and request.method == "PUT":
            return (
                service.update(
                    session, event_id, request.get_json(silent=True), principal=principal
                ),
                200,
            )
        if request is not None and request.method == "DELETE":
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
