"""Comments on any record (§36).

Polymorphic by design: one endpoint serves every entity, so a page that wants
a conversation gets one without a migration or a second handler.
"""

from __future__ import annotations

from typing import Any

from src.core.auth import json_body, me, requires
from src.core.db import session_scope
from src.services import comments as service


@requires("records.view")
def collection(app=None, operation: str = "", request=None, **_: Any):
    """The conversation on one record, or one more line of it."""
    method = (request.method if request is not None else "GET").upper()
    with session_scope() as session:
        if method == "POST":
            return service.create(session, json_body(), principal=me()), 201
        args = request.args if request is not None else {}
        return service.listing(session, args, principal=me()), 200


@requires("records.view")
def item(app=None, operation: str = "", request=None, comment_id: str = "", **kwargs: Any):
    """Change or withdraw one comment. Only its author may."""
    identifier = comment_id or str(kwargs.get("comment_id") or "")
    method = (request.method if request is not None else "GET").upper()
    with session_scope() as session:
        if method == "DELETE":
            return service.remove(session, identifier, principal=me()), 200
        return service.update(session, identifier, json_body(), principal=me()), 200


@requires("records.view")
def reactions(app=None, operation: str = "", request=None, comment_id: str = "", **kwargs: Any):
    """Add or take back one emoji reaction on a line."""
    identifier = comment_id or str(kwargs.get("comment_id") or "")
    with session_scope() as session:
        return service.react(session, identifier, json_body(), principal=me()), 200


@requires()
def read(app=None, operation: str = "", request=None, **_: Any):
    """Move the reader's "read up to here" on one conversation to now.

    No permission beyond being signed in: the conversation's own rule — the
    record's permission, or channel membership — is checked by the service.
    """
    with session_scope() as session:
        return service.mark_read(session, json_body(), principal=me()), 200


@requires()
def typing(app=None, operation: str = "", request=None, **_: Any):
    """Tell the others in a conversation that somebody is typing."""
    with session_scope() as session:
        return service.typing(session, json_body(), principal=me()), 200
