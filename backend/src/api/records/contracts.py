"""Contracts and the renewals pipeline (§13)."""

from __future__ import annotations

from typing import Any

from src.core.auth import json_body, me, requires
from src.core.db import session_scope
from src.services.records import contracts as service


def _method(request, default: str = "GET") -> str:
    return (request.method if request is not None else default).upper()


def _args(request):
    return request.args if request is not None else {}


@requires("records.view")
def collection(app=None, operation: str = "", request=None, **_: Any):
    """The contracts (GET), or a new one (POST, `contracts.manage`)."""
    with session_scope() as session:
        if _method(request) == "POST":
            return service.create(session, json_body(), principal=me()), 201
        return service.listing(session, _args(request), principal=me()), 200


@requires("records.view")
def item(app=None, operation: str = "", request=None, **kwargs: Any):
    """One contract: read, edit or delete it."""
    ident = kwargs.get("contract_id")
    method = _method(request)
    with session_scope() as session:
        if method == "PUT":
            return service.update(session, ident, json_body(), principal=me()), 200
        if method == "DELETE":
            return service.remove(session, ident, principal=me()), 200
        return service.get(session, ident, principal=me()), 200


@requires("records.view")
def move(app=None, operation: str = "", request=None, **kwargs: Any):
    """A drag on the pipeline board: a stage and a place in it."""
    with session_scope() as session:
        return service.move(session, kwargs.get("contract_id"), json_body(), principal=me()), 200


@requires("records.view")
def board(app=None, operation: str = "", request=None, **_: Any):
    """The pipeline, one column per stage."""
    with session_scope() as session:
        return service.board(session, _args(request), principal=me()), 200


@requires("records.view")
def forecast(app=None, operation: str = "", request=None, **_: Any):
    """Renewal ARR by quarter."""
    with session_scope() as session:
        return service.forecast(session, _args(request), principal=me()), 200


@requires("records.view")
def calendar(app=None, operation: str = "", request=None, **_: Any):
    """End dates and notice deadlines in a month."""
    with session_scope() as session:
        return service.calendar(session, _args(request), principal=me()), 200


@requires("records.view")
def files(app=None, operation: str = "", request=None, **kwargs: Any):
    """The contract's documents (GET), or its folder made ready for an upload (POST)."""
    with session_scope() as session:
        if _method(request) == "POST":
            return service.ensure_folder(session, kwargs.get("contract_id"), principal=me()), 200
        return service.files(session, kwargs.get("contract_id"), principal=me()), 200
