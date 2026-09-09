"""Entity record endpoints (§7, §8, §9).

The list side is the explorer's `POST /api/explorer/query`, deliberately: one
declaration per entity already yields the list, its filters, its facets, its
sort and its export, and a second list implementation is a second place for a
filter to be applied differently. This module is the other half — opening one
row, and writing it.

Reading and writing are separate permissions and separate handlers, but one
declaration: the fields a form may write are declared on the same `Resource`
that decides which fields the detail page shows, so the API cannot accept a
field the form never offers or refuse one it does.
"""

from __future__ import annotations

from typing import Any

from src.core.auth import json_body, me, requires
from src.core.db import session_scope
from src.services import bulk as bulk_service
from src.services import record_writes as writes
from src.services import records as service


@requires("records.view")
def collection(app=None, operation: str = "", request=None, resource_type: str = "", **kwargs: Any):
    """Create one record (§9). The server names it; the client describes it."""
    kind = resource_type or str(kwargs.get("resource_type") or "")
    with session_scope() as session:
        return writes.create(session, kind, json_body(), principal=me()), 201


@requires("records.view")
def item(
    app=None,
    operation: str = "",
    request=None,
    resource_type: str = "",
    record_id: str = "",
    **kwargs: Any,
):
    """One record: read it, edit it, or remove it.

    `records.view` gates the handler because every verb here begins by reading
    the record; the narrower permission each write needs is required by the
    service, so a caller who may read but not edit is told which permission is
    missing rather than which route to use.
    """
    kind = resource_type or str(kwargs.get("resource_type") or "")
    identifier = record_id or str(kwargs.get("record_id") or "")
    method = (request.method if request is not None else "GET").upper()

    with session_scope() as session:
        principal = me()
        if method == "PUT":
            return writes.update(session, kind, identifier, json_body(), principal=principal), 200
        if method == "DELETE":
            return writes.delete(session, kind, identifier, principal=principal), 200
        return service.detail(session, kind, identifier, principal=principal), 200


@requires("records.view")
def bulk_preview(
    app=None, operation: str = "", request=None, resource_type: str = "", **kwargs: Any
):
    """What a bulk gesture would do, before it does it (§75).

    A separate call and not a flag on the write, because the answer has to be
    read by a person and then confirmed. `records.view` gates it: counting the
    rows a filter names is reading them, and the narrower permission the write
    needs is reported *in* the answer, as a refusal with a reason, rather than
    as an error — somebody who may read but not delete should see how many rows
    they are not allowed to delete, not a 403 with no number in it.
    """
    kind = resource_type or str(kwargs.get("resource_type") or "")
    with session_scope() as session:
        return bulk_service.preview(session, kind, json_body(), principal=me()), 200


@requires("records.view")
def bulk(app=None, operation: str = "", request=None, resource_type: str = "", **kwargs: Any):
    """Apply one change to many records, and report both halves (§43).

    200 rather than 207 or 400 when some rows fail. Partial success is the
    normal outcome of a bulk gesture — a lost race here, a row somebody else
    deleted there — and the response body carries the applied count and every
    refusal with its reason. A status that says "error" would have a client
    throw away the news that forty-eight of fifty worked.

    `records.view` on the handler for the reason `item` documents: the write's
    own permission is required by the service, so a caller who may read but not
    write is told which permission is missing rather than which route to use.
    """
    kind = resource_type or str(kwargs.get("resource_type") or "")
    with session_scope() as session:
        return bulk_service.apply(session, kind, json_body(), principal=me()), 200
