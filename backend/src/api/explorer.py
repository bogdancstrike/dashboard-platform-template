"""JWT-protected Data Explorer endpoints."""

from __future__ import annotations

from typing import Any

from src.core.auth import json_body, me, requires
from src.core.db import session_scope
from src.services import explorer as service


@requires("records.view")
def catalogue(app=None, operation: str = "", request=None, **_: Any):
    """Publish the field and operator contract that configures the frontend."""
    with session_scope() as session:
        return service.catalogue(session, principal=me()), 200


@requires("records.view")
def query(app=None, operation: str = "", request=None, **_: Any):
    """Execute simple and nested conditions in PostgreSQL."""
    with session_scope() as session:
        return service.run(session, json_body(), principal=me()), 200


@requires("records.view", "records.export")
def export(app=None, operation: str = "", request=None, **_: Any):
    """Download the current exploration as CSV, JSON or XLSX (§30).

    A POST because the question can be a nested condition tree, which does not
    belong in a query string — and because a URL that triggers a download of
    200 000 rows is a URL somebody's link preflight will eventually fetch.
    """
    # No `session_scope`: the rows stream after this returns, on a session of
    # their own. See `core/export.stream_rows`.
    return service.export(json_body(), principal=me())
