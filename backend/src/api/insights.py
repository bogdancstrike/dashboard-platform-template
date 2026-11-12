"""Insights (§43) — a question about the records, answered as a generated page.

`generate` and `suggestion` return a *draft* (composed and bound, not saved);
`collection` POST keeps one. `refresh` re-runs a saved insight's queries — it
never asks the model again.
"""

from __future__ import annotations

from typing import Any

from src.core.auth import json_body, me, requires
from src.core.db import session_scope
from src.services import insights as service


def _method(request) -> str:
    return (request.method if request is not None else "GET").upper()


def _args(request) -> dict[str, Any]:
    return request.args.to_dict() if request is not None else {}


@requires("ai.use")
def collection(app=None, operation: str = "", request=None, **_: Any):
    """Saved insights this reader may see, with suggestions; or keep a draft."""
    with session_scope() as session:
        if _method(request) == "POST":
            return service.save(session, json_body(), principal=me()), 201
        return service.listing(session, _args(request), principal=me()), 200


@requires("ai.use")
def generate(app=None, operation: str = "", request=None, **_: Any):
    """Compose a page for a question — the model looks at the data, then lays it out."""
    with session_scope() as session:
        return service.generate(session, json_body(), principal=me()), 200


@requires("ai.use")
def suggestion(app=None, operation: str = "", request=None, key: str = "", **_: Any):
    """A suggested insight, bound for this reader. No model involved."""
    with session_scope() as session:
        return service.from_suggestion(session, key, principal=me()), 200


@requires("ai.use")
def item(app=None, operation: str = "", request=None, insight_id: str = "", **_: Any):
    """One insight (`?fresh=true` re-reads its numbers); rename, pin, share or remove it."""
    method = _method(request)
    with session_scope() as session:
        if method == "PUT":
            return service.update(session, insight_id, json_body(), principal=me()), 200
        if method == "DELETE":
            return service.remove(session, insight_id, principal=me()), 200
        return service.detail(session, insight_id, _args(request), principal=me()), 200


@requires("ai.use")
def refresh(app=None, operation: str = "", request=None, insight_id: str = "", **_: Any):
    """Re-run the insight's queries and keep the new numbers."""
    with session_scope() as session:
        return service.refresh(session, insight_id, principal=me()), 200
