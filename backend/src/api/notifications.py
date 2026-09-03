"""Notification endpoints (§17).

Every one of these is scoped to the caller. The id in a path is never enough on
its own — a notification belongs to exactly one person, and an endpoint that
looks one up by id alone is an endpoint that will eventually hand somebody
else's mail to whoever guesses a UUID.
"""

from __future__ import annotations

from typing import Any

from src.core.auth import json_body, me, requires
from src.core.db import session_scope
from src.core.pagination import parse_page
from src.services import notifications as service


@requires()
def collection(app=None, operation: str = "", request=None, **_: Any):
    """The caller's notifications, newest first, with the unread counts."""
    args = request.args if request is not None else {}
    principal = me()
    page = parse_page(args, default_sort="created_at")
    with session_scope() as session:
        return service.listing(session, principal.user_id, args, page), 200


@requires()
def unread_counts(app=None, operation: str = "", request=None, **_: Any):
    """Just the numbers — what the header badge polls when the socket is down."""
    principal = me()
    with session_scope() as session:
        return service.counts(session, principal.user_id), 200


@requires()
def item(app=None, operation: str = "", request=None, notification_id: str = "", **kwargs: Any):
    """Mark one read or unread, or delete it."""
    principal = me()
    identifier = notification_id or str(kwargs.get("notification_id") or "")
    method = (request.method if request is not None else "PUT").upper()

    with session_scope() as session:
        if method == "DELETE":
            return service.delete(session, principal.user_id, identifier), 200

        body = json_body()
        if body.get("is_read") is False:
            return service.mark_unread(session, principal.user_id, identifier), 200
        return service.mark_read(session, principal.user_id, identifier), 200


@requires()
def mark_all(app=None, operation: str = "", request=None, **_: Any):
    """Mark everything read, or everything in one category."""
    principal = me()
    body = json_body()
    with session_scope() as session:
        return service.mark_all_read(
            session, principal.user_id, category=body.get("category")
        ), 200
