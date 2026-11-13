"""Time tracking (Time & decisions): the timer, entries, the week, reports.

`time.track` is checked by the service on every call, because whose time a
call is about — mine, or somebody else's under `time.approve` — is decided by
its arguments, not by the route.
"""

from __future__ import annotations

from typing import Any

from src.core.auth import authenticated, json_body, me
from src.core.db import session_scope
from src.services.decisions import timekeeping as service


def _args(request):
    return request.args if request is not None else {}


@authenticated
def timer(app=None, operation: str = "", request=None, **_: Any):
    """GET what is running; POST to start one (stopping any other)."""
    method = (request.method if request is not None else "GET").upper()
    with session_scope() as session:
        if method == "POST":
            return service.start(session, json_body(), principal=me()), 200
        return service.current(session, principal=me()), 200


@authenticated
def stop(app=None, operation: str = "", request=None, **_: Any):
    """Stop the running timer, with an optional note."""
    with session_scope() as session:
        return service.stop(session, json_body(), principal=me()), 200


@authenticated
def entries(app=None, operation: str = "", request=None, **_: Any):
    """GET entries (mine, or a person's under time.approve); POST a manual one."""
    method = (request.method if request is not None else "GET").upper()
    with session_scope() as session:
        if method == "POST":
            return service.create(session, json_body(), principal=me()), 201
        return service.listing(session, _args(request), principal=me()), 200


@authenticated
def entry(app=None, operation: str = "", request=None, **kwargs: Any):
    """Edit (PUT) or remove (DELETE) one of my entries in an unlocked week."""
    method = (request.method if request is not None else "PUT").upper()
    ident = str(kwargs.get("entry_id") or "")
    with session_scope() as session:
        if method == "DELETE":
            return service.delete(session, ident, principal=me()), 200
        return service.update(session, ident, json_body(), principal=me()), 200


@authenticated
def week(app=None, operation: str = "", request=None, **_: Any):
    """One person's week as a grid: records down, days across, totals."""
    with session_scope() as session:
        return service.week(session, _args(request), principal=me()), 200


@authenticated
def cell(app=None, operation: str = "", request=None, **_: Any):
    """Set one cell of my week grid to a number of minutes."""
    with session_scope() as session:
        return service.set_cell(session, json_body(), principal=me()), 200


@authenticated
def submit(app=None, operation: str = "", request=None, **_: Any):
    """Submit my week for approval, which locks it."""
    with session_scope() as session:
        return service.submit_week(session, json_body(), principal=me()), 200


@authenticated
def team(app=None, operation: str = "", request=None, **_: Any):
    """Everybody's week and its timesheet state, for approvers."""
    with session_scope() as session:
        return service.team(session, _args(request), principal=me()), 200


@authenticated
def report(app=None, operation: str = "", request=None, **_: Any):
    """Totals by person, project, customer, work item or day."""
    with session_scope() as session:
        return service.report(session, _args(request), principal=me()), 200


@authenticated
def export(app=None, operation: str = "", request=None, **_: Any):
    """The report's entries as a CSV or XLSX file."""
    return service.export(_args(request), principal=me())


@authenticated
def subjects(app=None, operation: str = "", request=None, **_: Any):
    """Tasks, tickets and projects time can be booked against."""
    with session_scope() as session:
        return service.subjects(session, _args(request), principal=me()), 200


@authenticated
def on_subject(app=None, operation: str = "", request=None, **_: Any):
    """The time logged on one task or ticket."""
    with session_scope() as session:
        return service.on_subject(session, _args(request), principal=me()), 200
