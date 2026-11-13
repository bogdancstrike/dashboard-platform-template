"""Ask your documents (§44) — collections, their files, and questions with citations.

The reading itself happens off the request: an add or a reprocess commits the
QUEUED rows first and only then spawns the work (`services/knowledge.start_pending`),
so a background job never looks for a row still inside the request's transaction.
"""

from __future__ import annotations

from typing import Any

from src.core.auth import json_body, me, requires
from src.core.db import session_scope
from src.services.knowledge import collections as service


def _method(request) -> str:
    return (request.method if request is not None else "GET").upper()


def _args(request) -> dict[str, Any]:
    return request.args.to_dict() if request is not None else {}


@requires("ai.use")
def overview(app=None, operation: str = "", request=None, **_: Any):
    """Headline numbers across every collection this reader may see."""
    with session_scope() as session:
        return service.overview(session, principal=me()), 200


@requires("ai.use")
def collections(app=None, operation: str = "", request=None, **_: Any):
    """The collections this reader may see, or a new one."""
    with session_scope() as session:
        if _method(request) == "POST":
            return service.create(session, json_body(), principal=me()), 201
        return service.listing(session, _args(request), principal=me()), 200


@requires("ai.use")
def collection(app=None, operation: str = "", request=None, collection_id: str = "", **_: Any):
    """One collection with its documents; rename, re-share or remove it."""
    method = _method(request)
    with session_scope() as session:
        if method == "PUT":
            return service.update(session, collection_id, json_body(), principal=me()), 200
        if method == "DELETE":
            return service.remove(session, collection_id, principal=me()), 200
        return service.detail(session, collection_id, principal=me()), 200


@requires("ai.use")
def documents(app=None, operation: str = "", request=None, collection_id: str = "", **_: Any):
    """Put files of the file manager in the collection and start reading them."""
    with session_scope() as session:
        result = service.add_documents(session, collection_id, json_body(), principal=me())
    service.start_pending(result.pop("pending"))
    return result, 201


@requires("ai.use")
def document(app=None, operation: str = "", request=None, collection_id: str = "",
             document_id: str = "", **_: Any):
    """Where one document's reading stands, or take it out of the collection."""
    with session_scope() as session:
        if _method(request) == "DELETE":
            return service.remove_document(session, collection_id, document_id, principal=me()), 200
        return service.document_detail(session, collection_id, document_id, principal=me()), 200


@requires("ai.use")
def reprocess(app=None, operation: str = "", request=None, collection_id: str = "",
              document_id: str = "", **_: Any):
    """Read a document again — after a failure, or with a newer converter."""
    with session_scope() as session:
        result = service.reprocess(session, collection_id, document_id, principal=me())
    service.start_pending(result.pop("pending"))
    return result, 202


@requires("ai.use")
def passage(app=None, operation: str = "", request=None, collection_id: str = "",
            chunk_id: str = "", **_: Any):
    """One cited passage, with its page and the boxes to mark."""
    with session_scope() as session:
        return service.passage(session, collection_id, chunk_id, principal=me()), 200


@requires("ai.use")
def suggestions(app=None, operation: str = "", request=None, collection_id: str = "", **_: Any):
    """Questions worth asking this collection."""
    with session_scope() as session:
        return service.suggestions(session, collection_id, principal=me()), 200


@requires("ai.use")
def history(app=None, operation: str = "", request=None, collection_id: str = "", **_: Any):
    """This reader's questions of the collection, and the conversations they form."""
    with session_scope() as session:
        return service.history(session, collection_id, _args(request), principal=me()), 200


@requires("ai.use")
def thread(app=None, operation: str = "", request=None, collection_id: str = "",
           thread_id: str = "", **_: Any):
    """Forget one conversation."""
    with session_scope() as session:
        return service.forget_thread(session, collection_id, thread_id, principal=me()), 200


@requires("ai.use")
def ask(app=None, operation: str = "", request=None, **_: Any):
    """Answer a question from a collection's documents, with numbered citations."""
    with session_scope() as session:
        return service.ask(session, json_body(), principal=me()), 200
