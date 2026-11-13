"""Grouped analysis over any dataset (§2, §28, §44).

Two endpoints for four screens. The analytics workspace, the report builder,
the chart builder and the map all ask *group these rows by these columns and
measure them this way*, so they share one compiler — and one place where "last
30 days" is decided.
"""

from __future__ import annotations

from src.api.handler import Call, endpoint
from src.core.auth import me, requires
from src.core.db import session_scope
from src.services.analytics import analysis as service


@requires("records.view")
@endpoint
def catalogue(call: Call):
    """What each dataset can be grouped by, measured by, and over which periods."""
    return service.catalogue(principal=me()), 200


@requires("records.view")
@endpoint
def run(call: Call):
    """Execute one analysis, aggregated entirely in PostgreSQL."""
    with session_scope() as session:
        return service.run(session, call.body, principal=me()), 200
