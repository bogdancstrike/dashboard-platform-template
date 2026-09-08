"""The reader's own security endpoints (§41).

**No permission, and that is the design.** Every operation here is scoped to
the caller's own `user_id`, and being signed in is the qualification for seeing
your own sessions. A security page that had to be granted would be one most
people never see, and its whole value is that the person whose account it is
can look without asking anybody. `@requires()` with no arguments is
authenticated-only, which is what these carry.

Six operations: **overview** answers "is anything wrong" in one glance,
**sessions** lists the sign-ins with the current one marked, **revoke** and
**revoke_others** are the two ways to sign a device out, **trust** marks one as
recognised, **history** is the sign-in log including its failures, and
**events** is what the platform has noticed — with `PUT` on one to resolve it.

Nothing here deletes. A session is revoked, an event is resolved, and the
history is a record: a security page whose rows can be tidied away is one an
attacker tidies away.
"""

from __future__ import annotations

from typing import Any

from src.core.auth import json_body, me, requires
from src.core.db import session_scope
from src.services import security as service


@requires()
def overview(app=None, operation: str = "", request=None, **_: Any):
    """The three things worth knowing before scrolling.

    A summary rather than a row of counts: the page's job is to answer "is
    anything wrong" at a glance, and numbers make a reader do the arithmetic.
    """
    with session_scope() as session:
        return service.overview(session, principal=me()), 200


@requires()
def sessions(app=None, operation: str = "", request=None, **_: Any):
    """Every sign-in on this account, the live ones first.

    `current` on each row is derived from *this request's* session claim rather
    than from the stored column, because which one you are reading the page
    from is a fact about the request.
    """
    with session_scope() as session:
        return service.sessions(session, principal=me()), 200


@requires()
def session_item(app=None, operation: str = "", request=None, session_id: str = "", **kwargs: Any):
    """Sign one device out, or mark it as one you recognise.

    `DELETE` revokes — and the revocation is *enforced*, by
    `core/auth._touch_session`, which is what makes this button worth having:
    the model claimed a revoked session is refused on its next request long
    before anything read the table.
    """
    identifier = session_id or str(kwargs.get("session_id") or "")
    method = (request.method if request is not None else "GET").upper()
    with session_scope() as scope:
        if method == "DELETE":
            return service.revoke(scope, identifier, principal=me()), 200
        return service.trust(scope, identifier, json_body(), principal=me()), 200


@requires()
def revoke_others(app=None, operation: str = "", request=None, **_: Any):
    """Sign out everywhere else, keeping this session.

    The action somebody takes when they think their password is known. It keeps
    the current session for a practical reason rather than a cautious one: an
    operation that signed you out too would make its own result impossible to
    look at.
    """
    with session_scope() as session:
        return service.revoke_others(session, principal=me()), 200


@requires()
def history(app=None, operation: str = "", request=None, **_: Any):
    """This account's recent sign-ins, filtered and faceted in PostgreSQL.

    Successes *and* failures: a failed sign-in from an address you do not
    recognise is what this page exists to show, so "only the failures" is a
    query rather than a narrowing of the page in hand.
    """
    args = request.args if request is not None else {}
    with session_scope() as session:
        return service.history(session, args, principal=me()), 200


@requires()
def events(app=None, operation: str = "", request=None, **_: Any):
    """What the platform has noticed about this account."""
    args = request.args if request is not None else {}
    with session_scope() as session:
        return service.events(session, args, principal=me()), 200


@requires()
def event_item(app=None, operation: str = "", request=None, event_id: str = "", **kwargs: Any):
    """Mark one event as dealt with, or as not.

    Reversible and not a delete: "I have seen this and it was me" is worth
    recording, and losing the row would leave the page unable to answer whether
    anything was ever looked at.
    """
    identifier = event_id or str(kwargs.get("event_id") or "")
    with session_scope() as session:
        return service.resolve(session, identifier, json_body(), principal=me()), 200
