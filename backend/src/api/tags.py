"""Tag endpoints (§37).

The permission split is the point, and it is not the obvious one: reading the
vocabulary needs nothing beyond being signed in, because a tag is a label on
records the caller can already see and a picker that cannot list the options is
not a picker. *Applying* one needs `records.update` — it is an edit to that
record and it is audited as one. Changing the vocabulary itself needs
`tags.manage`, because a rename changes what every record carrying the tag says.
"""

from __future__ import annotations

from typing import Any

from src.core.auth import json_body, me, requires
from src.core.db import session_scope
from src.services import tags as service


@requires()
def collection(app=None, operation: str = "", request=None, **_: Any):
    """The vocabulary, or a new tag in it."""
    method = (request.method if request is not None else "GET").upper()
    with session_scope() as session:
        if method == "POST":
            return service.create(session, json_body(), principal=me()), 201
        return service.vocabulary(session, principal=me()), 200


@requires()
def item(app=None, operation: str = "", request=None, tag_id: str = "", **kwargs: Any):
    """Rename, recolour or remove one tag."""
    identifier = tag_id or str(kwargs.get("tag_id") or "")
    method = (request.method if request is not None else "GET").upper()
    with session_scope() as session:
        principal = me()
        if method == "PUT":
            return service.update(session, identifier, json_body(), principal=principal), 200
        return service.remove(session, identifier, principal=principal), 200


@requires("records.view")
def on_record(
    app=None,
    operation: str = "",
    request=None,
    resource_type: str = "",
    record_id: str = "",
    **kwargs: Any,
):
    """The tags on one record, and setting them.

    `records.view` gates the handler because both verbs begin by reading the
    record; the write's own permission is required by the service, so a caller
    who may read but not edit is told which permission is missing rather than
    which route to use.
    """
    kind = resource_type or str(kwargs.get("resource_type") or "")
    identifier = record_id or str(kwargs.get("record_id") or "")
    method = (request.method if request is not None else "GET").upper()
    with session_scope() as session:
        principal = me()
        if method == "PUT":
            return service.apply(session, kind, identifier, json_body(), principal=principal), 200
        return service.on_record(session, kind, identifier, principal=principal), 200
