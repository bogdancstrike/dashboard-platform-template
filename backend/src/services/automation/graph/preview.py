"""Looking before running: a dry-run trace of a draft and sample records."""

from __future__ import annotations

from typing import Any

from sqlalchemy import select

from src.core.errors import ValidationError
from src.core.pagination import parse_uuid
from src.core.repository import get_or_404
from src.services.automation.graph.engine import _walk
from src.services.automation.graph.legacy import from_legacy
from src.services.automation.graph.shape import (
    PERMISSION,
    _resource,
    normalize,
    trigger_of,
)
from src.services.automation.graph.storage import _rule, ensure
from src.services.automation.graph.walk import (
    Walk,
    _matches_for,
    resource_for_principal,
)


def trace(session, rule_id: Any, payload: dict[str, Any] | None, *, principal) -> dict[str, Any]:
    """The test run: one chosen record through the draft (or published) graph.

    A dry walk that writes nothing — no run row either, because a test on a
    draft is not something the rule *did*. Reports, per node, what happened to
    the record, and which connections it travelled.
    """
    principal.require(PERMISSION)
    rule = _rule(session, rule_id)
    graph_row = ensure(session, rule)
    body = payload if isinstance(payload, dict) else {}
    stored = graph_row.published if body.get("graph") == "published" else (graph_row.draft or graph_row.published)
    graph = normalize(stored) if stored else from_legacy(rule)
    trigger = trigger_of(graph)
    resource = _resource(((trigger or {}).get("data") or {}).get("resource_type"))
    if trigger is None or resource is None:
        raise ValidationError("Choose a trigger and its dataset before testing.")
    resource_for_principal(resource, principal)
    record_id = parse_uuid(body.get("record_id"), field="record_id")
    row = get_or_404(session, resource.model, record_id, "That record does not exist.", live=True)
    match = _matches_for(resource, [row])[0]
    walk = Walk(rule=rule, graph=graph, resource=resource, dry_run=True, version=graph_row.version)
    try:
        _walk(session, walk, [(trigger["id"], [match])])
    except ValidationError as error:
        return {"record": {"id": match.id, "label": match.label, "path": match.path},
                "nodes": [], "edges": [], "actions": [], "error": error.message}
    entry = walk.records.get(match.id) or {"nodes": [], "actions": []}
    return {
        "record": {"id": match.id, "label": match.label, "path": match.path},
        "nodes": entry["nodes"],
        "edges": sorted(walk.edges_taken),
        "actions": entry["actions"],
        "error": None,
    }


def samples(session, rule_id: Any, args, *, principal) -> dict[str, Any]:
    """Records to test with: the newest in the trigger's dataset, optionally searched."""
    from sqlalchemy import String as SqlString
    from sqlalchemy import cast, or_

    principal.require(PERMISSION)
    rule = _rule(session, rule_id)
    graph_row = ensure(session, rule)
    trigger = trigger_of(graph_row.draft or graph_row.published) or {}
    resource = _resource((trigger.get("data") or {}).get("resource_type") or rule.resource_type)
    if resource is None:
        return {"items": []}
    resource_for_principal(resource, principal)
    statement = select(resource.model)
    deleted = getattr(resource.model, "deleted_at", None)
    if deleted is not None:
        statement = statement.where(deleted.is_(None))
    text = str(args.get("q") or "").strip()
    if text:
        columns = [getattr(resource.model, name) for name in (resource.title_field, resource.subtitle_field, "reference")
                   if name and hasattr(resource.model, name)]
        if columns:
            statement = statement.where(or_(*[cast(column, SqlString).ilike(f"%{text}%") for column in columns]))
    order = getattr(resource.model, "updated_at", None)
    if order is not None:
        statement = statement.order_by(order.desc())
    rows = session.scalars(statement.limit(20)).unique().all()
    return {"items": [{"id": str(row.id), "label": resource.label_for(row),
                       "status": getattr(row, resource.status_field, None) if resource.status_field else None}
                      for row in rows]}
