"""Intake forms (Time & decisions): the designer's API and the public door.

The two `public_*` handlers are the only endpoints in this feature an
anonymous caller reaches, and they are listed as such in the endpoint-map test.
They still look for a signed-in caller (`optional`), because an INTERNAL form
answers only to one and a person's own submission is credited to them.
"""

from __future__ import annotations

from typing import Any

from src.core.auth import authenticated, json_body, maybe_me, me, optional
from src.core.db import session_scope
from src.services import forms as service


def _method(request, default: str = "GET") -> str:
    return (request.method if request is not None else default).upper()


@authenticated
def collection(app=None, operation: str = "", request=None, **_: Any):
    """Every form, with recent submission counts; POST a new one."""
    with session_scope() as session:
        if _method(request) == "POST":
            return service.save(session, json_body(), principal=me()), 201
        args = request.args if request is not None else {}
        return service.listing(session, args, principal=me()), 200


@authenticated
def item(app=None, operation: str = "", request=None, **kwargs: Any):
    """GET, PUT or DELETE one form."""
    ident = str(kwargs.get("form_id") or "")
    method = _method(request)
    with session_scope() as session:
        if method == "PUT":
            return service.save(session, json_body(), principal=me(), ident=ident), 200
        if method == "DELETE":
            return service.remove(session, ident, principal=me()), 200
        return service.entry(session, ident, principal=me()), 200


@authenticated
def submissions(app=None, operation: str = "", request=None, **kwargs: Any):
    """A form's submissions with conversion status and links to the records."""
    args = request.args if request is not None else {}
    with session_scope() as session:
        return service.submissions(session, str(kwargs.get("form_id") or ""), args, principal=me()), 200


@authenticated
def retry(app=None, operation: str = "", request=None, **kwargs: Any):
    """Convert a failed submission again."""
    with session_scope() as session:
        return service.retry(session, str(kwargs.get("form_id") or ""),
                             str(kwargs.get("submission_id") or ""), principal=me()), 200


@optional
def public_form(app=None, operation: str = "", request=None, **kwargs: Any):
    """A published form as its public page renders it."""
    with session_scope() as session:
        return service.public_form(session, str(kwargs.get("slug") or ""), principal=maybe_me()), 200


@optional
def public_submit(app=None, operation: str = "", request=None, **kwargs: Any):
    """Answer a form. Rate-limited per address and guarded by a challenge."""
    from flask import request as flask_request

    forwarded = (flask_request.headers.get("X-Forwarded-For") or "").split(",")[0].strip()
    client = forwarded or flask_request.remote_addr or "unknown"
    with session_scope() as session:
        return service.submit(session, str(kwargs.get("slug") or ""), json_body(),
                              principal=maybe_me(), client=client), 201
