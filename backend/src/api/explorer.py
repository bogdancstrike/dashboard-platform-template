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
