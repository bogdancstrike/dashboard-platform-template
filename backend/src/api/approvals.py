"""The approvals inbox (Time & decisions).

Reading is open to everybody signed in — the inbox shows each person their own
requests and whatever they hold the permission to decide, and nothing else.
Deciding checks the request's own permission, not one declared here, because
which permission decides a request is the provider's business.
"""

from __future__ import annotations

from typing import Any

from src.core.auth import authenticated, json_body, me
from src.core.db import session_scope
from src.services import approval_kinds, approvals as service


def _ident(kwargs: dict[str, Any], key: str) -> str:
    return str(kwargs.get(key) or "")


@authenticated
def collection(app=None, operation: str = "", request=None, **_: Any):
    """The inbox, my requests or the decision history, filtered and faceted."""
    args = request.args if request is not None else {}
    with session_scope() as session:
        return service.listing(session, args, principal=me()), 200


@authenticated
def item(app=None, operation: str = "", request=None, **kwargs: Any):
    """One request with its history and the provider's details."""
    with session_scope() as session:
        return service.entry(session, _ident(kwargs, "approval_id"), principal=me()), 200


@authenticated
def decision(app=None, operation: str = "", request=None, **kwargs: Any):
    """Approve or reject one request, with a comment the requester reads."""
    with session_scope() as session:
        return service.decide(session, _ident(kwargs, "approval_id"), json_body(), principal=me()), 200


@authenticated
def bulk(app=None, operation: str = "", request=None, **_: Any):
    """Approve or reject several; each succeeds or fails on its own."""
    with session_scope() as session:
        return service.decide_many(session, json_body(), principal=me()), 200


@authenticated
def withdraw(app=None, operation: str = "", request=None, **kwargs: Any):
    """Take back a request of mine that nobody has decided yet."""
    with session_scope() as session:
        return service.withdraw(session, _ident(kwargs, "approval_id"), principal=me()), 200


@authenticated
def access(app=None, operation: str = "", request=None, **_: Any):
    """Ask for a permission, from the page that needed it."""
    with session_scope() as session:
        return approval_kinds.request_access(session, json_body(), principal=me()), 201


@authenticated
def publish_report(app=None, operation: str = "", request=None, **_: Any):
    """Ask for one of my reports to be published to the organisation."""
    with session_scope() as session:
        return approval_kinds.request_publish(session, json_body(), principal=me()), 201


@authenticated
def rules(app=None, operation: str = "", request=None, **_: Any):
    """The change rules (GET), or a new one (POST, `approvals.decide`)."""
    method = (request.method if request is not None else "GET").upper()
    with session_scope() as session:
        if method == "POST":
            return approval_kinds.save_rule(session, json_body(), principal=me()), 201
        return approval_kinds.rules(session, principal=me()), 200


@authenticated
def rule(app=None, operation: str = "", request=None, **kwargs: Any):
    """Edit (PUT) or remove (DELETE) one change rule."""
    method = (request.method if request is not None else "PUT").upper()
    ident = _ident(kwargs, "rule_id")
    with session_scope() as session:
        if method == "DELETE":
            return approval_kinds.delete_rule(session, ident, principal=me()), 200
        return approval_kinds.save_rule(session, json_body(), principal=me(), rule_id=ident), 200
