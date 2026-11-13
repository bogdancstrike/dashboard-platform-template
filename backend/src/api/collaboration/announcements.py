"""Announcements (§17, §34).

Two collections, deliberately, and not one endpoint with a flag: `/api/announcements`
answers "what am I being told" and needs nothing beyond a signed-in reader,
while `/api/announcements/drafts` answers "what have we written" and needs
`announcements.manage`. One endpoint doing both would be one `if` away from
publishing somebody's draft.
"""

from __future__ import annotations

from typing import Any

from src.api.handler import Call, endpoint
from src.core.auth import authenticated, me
from src.core.db import session_scope
from src.services.collaboration import announcements as service


@authenticated
@endpoint
def collection(call: Call):
    """The notices addressed to this reader, or a new one (`announcements.manage`)."""
    principal = me()
    if call.method == "POST":
        # Checked before the session is opened, not inside the service: a
        # refusal that has already taken a database connection has paid for
        # work it was never going to do, and on a pool under load that is the
        # connection somebody else was waiting for.
        principal.require(service.MANAGE_PERMISSION)
        with session_scope() as session:
            return service.create(session, call.loose_body, principal=principal), 201

    args = call.args
    with session_scope() as session:
        return service.feed(session, args, principal=principal), 200


@authenticated
@endpoint
def drafts(call: Call):
    """Every notice whatever its state — the author's list."""
    principal = me()
    principal.require(service.MANAGE_PERMISSION)
    args = call.args
    with session_scope() as session:
        return service.drafts(session, args, principal=principal), 200


@authenticated
@endpoint
def item(call: Call, announcement_id=None):
    """One notice: read it, change it, or withdraw it."""
    principal = me()
    if call.method in ("PUT", "DELETE"):
        principal.require(service.MANAGE_PERMISSION)
    with session_scope() as session:
        if call.method == "PUT":
            return (
                service.update(
                    session, announcement_id, call.loose_body, principal=principal
                ),
                200,
            )
        if call.method == "DELETE":
            return service.remove(session, announcement_id, principal=principal), 200
        return service.get(session, announcement_id, principal=principal), 200


@authenticated
def receipt(app=None, operation: str = "", request=None, announcement_id=None, **_: Any):
    """Record that this reader has seen — or agreed to — this notice."""
    with session_scope() as session:
        return (
            service.mark(
                session, announcement_id, request.get_json(silent=True) if request else None,
                principal=me(),
            ),
            200,
        )
