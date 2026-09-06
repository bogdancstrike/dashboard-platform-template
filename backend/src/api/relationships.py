"""How one record connects to the rest (§44, §50)."""

from __future__ import annotations

from typing import Any

from src.core.auth import me, requires
from src.core.db import session_scope
from src.services import relationships as service


@requires("records.view")
def overview(app=None, operation: str = "", request=None, **_: Any):
    """The connection map itself, before any record has been chosen.

    An explorer that opens on an empty search box asks the reader to already
    know what they are looking for; this answers the question they arrive with.
    """
    with session_scope() as session:
        return service.overview(session, principal=me()), 200


@requires("records.view")
def item(app=None, operation: str = "", request=None, resource_type=None, record_id=None, **_: Any):
    """Everything this record points at, and everything pointing at it."""
    args = request.args if request is not None else {}
    with session_scope() as session:
        sample = args.get("sample")
        return service.graph(
            session, resource_type, record_id, principal=me(),
            **({"sample": int(sample)} if str(sample or "").isdigit() else {}),
        ), 200


@requires("records.view")
def network(app=None, operation: str = "", request=None, **_: Any):
    """A slice of the record graph, clustered into communities.

    The clustering is computed here rather than in the browser so that every
    viewer sees the same partition — a force simulation seeded by the client
    would draw a different answer on every reload.
    """
    args = request.args if request is not None else {}
    with session_scope() as session:
        return service.network(
            session,
            principal=me(),
            focus=args.get("focus"),
            **{
                key: int(args[key])
                for key in ("limit", "anchors")
                if str(args.get(key) or "").isdigit()
            },
        ), 200
