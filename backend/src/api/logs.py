"""System log endpoints (§22).

Read-only but for one write, and that write is a *policy* being applied rather
than a row being edited: `prune` enacts `retention.log_days`, and it takes the
number of days from the setting instead of the request precisely so it cannot
become an arbitrary delete wearing a retention policy's name.

The rows here are written by `core/logsink` from the outcome of each request,
so a log line an endpoint could edit would be a log line worth nothing.
"""

from __future__ import annotations

from typing import Any

from src.core.auth import me, requires
from src.core.db import session_scope
from src.services import logs as service


@requires("logs.view")
def catalogue(app=None, operation: str = "", request=None, **_: Any):
    """The filter vocabulary, the per-level counts and the retention bound."""
    with session_scope() as session:
        return service.catalogue(session, principal=me()), 200


@requires("logs.view")
def collection(app=None, operation: str = "", request=None, **_: Any):
    """One page of the log: filtered, faceted, sorted and paged in PostgreSQL."""
    args = request.args if request is not None else {}
    with session_scope() as session:
        return service.listing(session, args, principal=me()), 200


@requires("logs.view")
def tail(app=None, operation: str = "", request=None, **_: Any):
    """Whatever has arrived since the caller's cursor — the live tail (§22).

    A poll rather than a socket, so pausing is simply not asking and resuming
    asks from where it stopped. See the service docstring for why.
    """
    args = request.args if request is not None else {}
    with session_scope() as session:
        return service.tail(session, args, principal=me()), 200


@requires("logs.view")
def item(app=None, operation: str = "", request=None, line_id: str = "", **kwargs: Any):
    """One line in full: its context, its stack trace and its siblings."""
    identifier = line_id or str(kwargs.get("line_id") or "")
    with session_scope() as session:
        return service.entry(session, identifier, principal=me()), 200


@requires("logs.view", "settings.manage")
def prune(app=None, operation: str = "", request=None, **_: Any):
    """Apply the retention policy now (§22).

    Two permissions: reading the log and enacting the bound on it are different
    privileges, and the bound is a setting — somebody who may not change
    `retention.log_days` should not be able to apply it early either.
    """
    args = request.args if request is not None else {}
    with session_scope() as session:
        return service.prune(session, args, principal=me()), 200
