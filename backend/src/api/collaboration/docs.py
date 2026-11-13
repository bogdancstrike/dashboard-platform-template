"""The wiki and meeting notes (§48–49)."""

from __future__ import annotations

from typing import Any

from src.core.auth import json_body, me, requires
from src.core.db import session_scope
from src.services.collaboration import docs as service

VIEW = service.VIEW


def _method(request) -> str:
    return (request.method if request is not None else "GET").upper()


def _args(request):
    return request.args if request is not None else {}


def _id(value: str, kwargs: dict[str, Any], name: str) -> str:
    return value or str(kwargs.get(name) or "")


@requires(VIEW)
def spaces(app=None, operation: str = "", request=None, **_: Any):
    with session_scope() as session:
        if _method(request) == "POST":
            return service.create_space(session, json_body(), principal=me()), 201
        return service.spaces(session, principal=me()), 200


@requires(VIEW)
def space(app=None, operation: str = "", request=None, space_id: str = "", **kwargs: Any):
    identifier = _id(space_id, kwargs, "space_id")
    method = _method(request)
    with session_scope() as session:
        if method == "DELETE":
            return service.delete_space(session, identifier, principal=me()), 200
        if method in ("PUT", "PATCH"):
            return service.update_space(session, identifier, json_body(), principal=me()), 200
        return service.tree(session, identifier, principal=me()), 200


@requires(VIEW)
def pages(app=None, operation: str = "", request=None, **_: Any):
    """A new page; or, read, the most recently changed ones."""
    with session_scope() as session:
        if _method(request) == "POST":
            return service.create_page(session, json_body(), principal=me()), 201
        return service.recent(session, principal=me()), 200


@requires(VIEW)
def page(app=None, operation: str = "", request=None, page_id: str = "", **kwargs: Any):
    identifier = _id(page_id, kwargs, "page_id")
    method = _method(request)
    with session_scope() as session:
        if method == "DELETE":
            return service.delete_page(session, identifier, principal=me()), 200
        if method in ("PUT", "PATCH"):
            return service.update_page(session, identifier, json_body(), principal=me()), 200
        return service.page(session, identifier, principal=me()), 200


@requires(VIEW)
def move(app=None, operation: str = "", request=None, page_id: str = "", **kwargs: Any):
    with session_scope() as session:
        return service.move_page(session, _id(page_id, kwargs, "page_id"), json_body(), principal=me()), 200


@requires(VIEW)
def revisions(app=None, operation: str = "", request=None, page_id: str = "", **kwargs: Any):
    with session_scope() as session:
        return service.revisions(session, _id(page_id, kwargs, "page_id"), principal=me()), 200


@requires(VIEW)
def revision(app=None, operation: str = "", request=None, page_id: str = "", revision_id: str = "",
             **kwargs: Any):
    with session_scope() as session:
        return service.revision(session, _id(page_id, kwargs, "page_id"),
                                _id(revision_id, kwargs, "revision_id"), principal=me()), 200


@requires(VIEW)
def restore(app=None, operation: str = "", request=None, page_id: str = "", revision_id: str = "",
            **kwargs: Any):
    with session_scope() as session:
        return service.restore(session, _id(page_id, kwargs, "page_id"),
                               _id(revision_id, kwargs, "revision_id"), principal=me()), 200


@requires(VIEW)
def links(app=None, operation: str = "", request=None, page_id: str = "", **kwargs: Any):
    with session_scope() as session:
        return service.add_link(session, _id(page_id, kwargs, "page_id"), json_body(), principal=me()), 200


@requires(VIEW)
def link(app=None, operation: str = "", request=None, page_id: str = "", link_id: str = "", **kwargs: Any):
    with session_scope() as session:
        return service.remove_link(session, _id(page_id, kwargs, "page_id"),
                                   _id(link_id, kwargs, "link_id"), principal=me()), 200


@requires(VIEW)
def actions(app=None, operation: str = "", request=None, page_id: str = "", **kwargs: Any):
    """Turn an action item into a task."""
    with session_scope() as session:
        return service.create_task(session, _id(page_id, kwargs, "page_id"), json_body(), principal=me()), 200


@requires(VIEW)
def summary(app=None, operation: str = "", request=None, page_id: str = "", **kwargs: Any):
    with session_scope() as session:
        return service.summarise(session, _id(page_id, kwargs, "page_id"), principal=me()), 200


@requires(VIEW)
def backlinks(app=None, operation: str = "", request=None, **_: Any):
    with session_scope() as session:
        return service.backlinks(session, _args(request), principal=me()), 200


@requires(VIEW)
def search(app=None, operation: str = "", request=None, **_: Any):
    with session_scope() as session:
        return service.search(session, _args(request), principal=me()), 200


@requires(VIEW)
def templates(app=None, operation: str = "", request=None, **_: Any):
    return service.templates(principal=me()), 200


@requires(VIEW)
def meetings(app=None, operation: str = "", request=None, **_: Any):
    """The notes taken in one event; or, posted, open (or begin) them."""
    with session_scope() as session:
        if _method(request) == "POST":
            return service.take_notes(session, json_body(), principal=me()), 200
        return service.meeting_notes(session, _args(request), principal=me()), 200
