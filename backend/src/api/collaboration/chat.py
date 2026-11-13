"""Team chat (§47): channels, direct messages, search and presence.

The messages themselves go through `/api/comments` with `resource_type =
chat_channel` — one set of rules for every conversation in the product.
"""

from __future__ import annotations

from typing import Any

from src.api.handler import Call, endpoint
from src.core.auth import json_body, me, requires
from src.core.db import session_scope
from src.services.collaboration import chat as service

USE = service.USE


def _method(request) -> str:
    return (request.method if request is not None else "GET").upper()


@requires(USE)
def channels(app=None, operation: str = "", request=None, **_: Any):
    """The conversations this person is in, or a new channel."""
    with session_scope() as session:
        if _method(request) == "POST":
            return service.create(session, json_body(), principal=me()), 201
        return service.channels(session, request.args if request is not None else {}, principal=me()), 200


@requires(USE)
def channel(app=None, operation: str = "", request=None, channel_id: str = "", **kwargs: Any):
    """One conversation: read it, rename it, or archive it."""
    identifier = channel_id or str(kwargs.get("channel_id") or "")
    method = _method(request)
    with session_scope() as session:
        if method == "DELETE":
            return service.archive(session, identifier, principal=me()), 200
        if method in ("PUT", "PATCH"):
            return service.update(session, identifier, json_body(), principal=me()), 200
        return service.detail(session, identifier, principal=me()), 200


@requires(USE)
@endpoint
def join(call: Call, channel_id: str = ""):
    identifier = channel_id
    with session_scope() as session:
        return service.join(session, identifier, principal=me()), 200


@requires(USE)
@endpoint
def leave(call: Call, channel_id: str = ""):
    identifier = channel_id
    with session_scope() as session:
        return service.leave(session, identifier, principal=me()), 200


@requires(USE)
@endpoint
def members(call: Call, channel_id: str = ""):
    identifier = channel_id
    with session_scope() as session:
        return service.add_members(session, identifier, call.body, principal=me()), 200


@requires(USE)
@endpoint
def member(call: Call, channel_id: str = "", user_id: str = ""):
    identifier = channel_id
    person = user_id
    with session_scope() as session:
        return service.remove_member(session, identifier, person, principal=me()), 200


@requires(USE)
@endpoint
def direct(call: Call):
    """The conversation with one other person, begun if it does not exist."""
    with session_scope() as session:
        return service.direct(session, call.body, principal=me()), 200


@requires(USE)
def search(app=None, operation: str = "", request=None, **_: Any):
    with session_scope() as session:
        return service.search(session, request.args if request is not None else {}, principal=me()), 200


@requires(USE)
def presence(app=None, operation: str = "", request=None, **_: Any):
    """Who is online and away; or, posted, this person's own status."""
    if _method(request) == "POST":
        return service.set_presence(json_body(), principal=me()), 200
    with session_scope() as session:
        return service.presence(session, request.args if request is not None else {}, principal=me()), 200
