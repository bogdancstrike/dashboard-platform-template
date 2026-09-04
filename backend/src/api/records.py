"""Entity record endpoints (§7, §8).

The list side is the explorer's `POST /api/explorer/query`, deliberately: one
declaration per entity already yields the list, its filters, its facets, its
sort and its export, and a second list implementation is a second place for a
filter to be applied differently. This module is the other half — opening one
row.
"""

from __future__ import annotations

from typing import Any

from src.core.auth import me, requires
from src.core.db import session_scope
from src.services import records as service


@requires("records.view")
def item(
    app=None,
    operation: str = "",
    request=None,
    resource_type: str = "",
    record_id: str = "",
    **kwargs: Any,
):
    """One record, with every field the entity declares."""
    kind = resource_type or str(kwargs.get("resource_type") or "")
    identifier = record_id or str(kwargs.get("record_id") or "")
    with session_scope() as session:
        return service.detail(session, kind, identifier, principal=me()), 200
