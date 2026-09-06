"""Grouped analysis over any dataset (§2, §28, §44).

Two endpoints for four screens. The analytics workspace, the report builder,
the chart builder and the map all ask *group these rows by these columns and
measure them this way*, so they share one compiler — and one place where "last
30 days" is decided.
"""

from __future__ import annotations

from typing import Any

from src.core.auth import json_body, me, requires
from src.core.db import session_scope
from src.services import analysis as service


@requires("records.view")
def catalogue(app=None, operation: str = "", request=None, **_: Any):
    """What each dataset can be grouped by, measured by, and over which periods."""
    return service.catalogue(principal=me()), 200


@requires("records.view")
def run(app=None, operation: str = "", request=None, **_: Any):
    """Execute one analysis, aggregated entirely in PostgreSQL."""
    with session_scope() as session:
        return service.run(session, json_body(), principal=me()), 200
