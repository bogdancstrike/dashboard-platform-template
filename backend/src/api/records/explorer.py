"""JWT-protected Data Explorer endpoints."""

from __future__ import annotations

from src.api.handler import Call, endpoint
from src.core.auth import me, requires
from src.core.db import session_scope
from src.services.records import explorer as service


@requires("records.view")
@endpoint
def catalogue(call: Call):
    """Publish the field and operator contract that configures the frontend."""
    with session_scope() as session:
        return service.catalogue(session, principal=me()), 200


@requires("records.view")
@endpoint
def query(call: Call):
    """Execute simple and nested conditions in PostgreSQL."""
    with session_scope() as session:
        return service.run(session, call.body, principal=me()), 200


@requires("records.view")
@endpoint
def insights(call: Call):
    """What the current question adds up to, aggregated in SQL.

    Takes the same payload the query takes, so the summary above a list can
    never describe a different set of rows from the list itself.
    """
    with session_scope() as session:
        return service.insights(session, call.body, principal=me()), 200


@requires("records.view", "records.export")
@endpoint
def export(call: Call):
    """Download the current exploration as CSV, JSON or XLSX (§30).

    A POST because the question can be a nested condition tree, which does not
    belong in a query string — and because a URL that triggers a download of
    200 000 rows is a URL somebody's link preflight will eventually fetch.
    """
    # No `session_scope`: the rows stream after this returns, on a session of
    # their own. See `core/export.stream_rows`.
    return service.export(call.body, principal=me())
