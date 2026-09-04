"""Audit explorer endpoints (§21).

Read-only, and that is the whole design. The ledger has one writer —
`core/audit.record`, appending in the same transaction as the change it
describes — and no endpoint here can create, edit or remove a row. An audit
trail with a `DELETE` is a trail whose absence of an entry proves nothing.
"""

from __future__ import annotations

from typing import Any

from src.core.auth import me, requires
from src.core.db import session_scope
from src.services import audit as service


@requires("audit.view")
def catalogue(app=None, operation: str = "", request=None, **_: Any):
    """The filter vocabulary the explorer's controls are generated from."""
    with session_scope() as session:
        return service.catalogue(session, principal=me()), 200


@requires("audit.view")
def collection(app=None, operation: str = "", request=None, **_: Any):
    """The ledger: filtered, faceted, sorted and paged in PostgreSQL."""
    args = request.args if request is not None else {}
    with session_scope() as session:
        return service.listing(session, args, principal=me()), 200


@requires("audit.view")
def item(app=None, operation: str = "", request=None, entry_id: str = "", **kwargs: Any):
    """One entry, with its field-level before → after diff."""
    identifier = entry_id or str(kwargs.get("entry_id") or "")
    with session_scope() as session:
        return service.entry(session, identifier, principal=me()), 200


@requires("audit.view", "records.export")
def export(app=None, operation: str = "", request=None, **_: Any):
    """The ledger as CSV, JSON or XLSX, under the filters on screen (§30).

    Two permissions, because reading the ledger and taking a copy of it off the
    platform are different privileges — and the second is the one that leaves
    the building.
    """
    args = request.args if request is not None else {}
    # No `session_scope` here: the response streams after this returns, so the
    # rows carry a session of their own. See `core/export.stream_rows`.
    return service.export(args, principal=me())


@requires("records.view")
def resource_timeline(app=None, operation: str = "", request=None, **_: Any):
    """Everything recorded against one record — the detail-page panel (§48).

    A lesser permission than the ledger, because reading the history of a
    record you may already read is not the privilege of reading everything
    anybody has ever done. The service refuses to answer without a resource,
    so this cannot become the ledger by omission.
    """
    args = request.args if request is not None else {}
    with session_scope() as session:
        return service.timeline(session, args, principal=me()), 200
