"""API client endpoints (§25).

One permission, `api.manage`, and deliberately one: a client's scopes and its
allowed addresses are exactly what somebody would want to know before attacking
it, so reading is not a lesser privilege than writing here.

Two responses in this module carry a plaintext secret — `collection` on create,
and `rotate`. Both are the *only* time that value exists outside the caller's
memory: the platform stores a hash, so there is no endpoint that can return it
again, and both say so in the payload rather than leaving somebody to find out.
"""

from __future__ import annotations

from typing import Any

from src.core.auth import me, requires
from src.core.db import session_scope
from src.services import api_clients as service


@requires("api.manage")
def catalogue(app=None, operation: str = "", request=None, **_: Any):
    """The statuses and the scopes *this caller* may grant.

    Only their own: offering the whole catalogue and refusing half of it on
    save would be a form that produces an error on purpose.
    """
    with session_scope() as session:
        return service.catalogue(session, principal=me()), 200


@requires("api.manage")
def collection(app=None, operation: str = "", request=None, **_: Any):
    """Every client — or a new one, with its first credential.

    The creation response carries the plaintext secret once. There is no
    endpoint that can return it again.
    """
    args = request.args if request is not None else {}
    method = (request.method if request is not None else "GET").upper()
    with session_scope() as session:
        if method == "POST":
            payload = (request.get_json(silent=True) if request is not None else None) or {}
            return service.create(session, payload, principal=me()), 201
        return service.listing(session, args, principal=me()), 200


@requires("api.manage")
def item(app=None, operation: str = "", request=None, client_id: str = "", **kwargs: Any):
    """One client: its credentials and the requests it has recently made."""
    identifier = client_id or str(kwargs.get("client_id") or "")
    method = (request.method if request is not None else "GET").upper()
    with session_scope() as session:
        if method == "PUT":
            payload = (request.get_json(silent=True) if request is not None else None) or {}
            return service.update(session, identifier, payload, principal=me()), 200
        if method == "DELETE":
            return service.remove(session, identifier, principal=me()), 200
        return service.entry(session, identifier, principal=me()), 200


@requires("api.manage")
def rotate(app=None, operation: str = "", request=None, client_id: str = "", **kwargs: Any):
    """Mint a new credential and put the old one on a deadline (§25).

    Not a replacement: the previous key keeps working for a grace period,
    because a rotation that killed it immediately is an outage with extra
    steps. The new plaintext is in this response and nowhere else, ever.
    """
    identifier = client_id or str(kwargs.get("client_id") or "")
    payload = (request.get_json(silent=True) if request is not None else None) or {}
    with session_scope() as session:
        return service.rotate(session, identifier, payload, principal=me()), 201


@requires("api.manage")
def credential(
    app=None, operation: str = "", request=None, credential_id: str = "", **kwargs: Any
):
    """Revoke one credential now, keeping the row (§25).

    Kept because the question after a leak is always *when, and by whom*, and a
    row that vanished answers neither.
    """
    identifier = credential_id or str(kwargs.get("credential_id") or "")
    with session_scope() as session:
        return service.revoke(session, identifier, principal=me()), 200
