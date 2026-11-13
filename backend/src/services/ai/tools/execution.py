"""Running a tool call: counts, one record, global and document search."""

from __future__ import annotations

import json
from typing import Any

from sqlalchemy import func

from src.core.errors import ApiError, ValidationError
from src.core.query import apply_filters
from src.core.rules import compile_tree, describe_tree
from src.services.ai.tools.tool_definitions import _cite, _tree, search_records
from src.services.records import detail as records
from src.services.records import explorer, search


def count_records(session, args: dict[str, Any], *, principal):
    resource = explorer.resource_for(args.get("dataset"), principal=principal)
    tree = _tree(session, resource, args.get("condition_tree"), principal)
    query_args = {"q": args["text"]} if args.get("text") else {}
    statement = apply_filters(explorer._base_statement(resource), query_args, resource.fields)
    predicate = compile_tree(tree, resource.fields)
    if predicate is not None:
        statement = statement.where(predicate)
    out: dict[str, Any] = {
        "dataset": resource.key,
        "total": session.scalar(statement.with_only_columns(func.count()).order_by(None)) or 0,
        "condition": describe_tree(tree, resource.fields) if tree else "",
    }
    group = str(args.get("group_by") or "")
    if group:
        spec = resource.fields.by_name.get(group)
        if spec is None:
            raise ValidationError(f"{resource.label} have no field {group!r}.")
        counted = func.count().label("n")
        rows = session.execute(
            statement.with_only_columns(spec.expression, counted).group_by(spec.expression)
            .order_by(counted.desc()).limit(20)
        ).all()
        out["by"] = group
        out["groups"] = [{"value": explorer._json_value(value), "count": n} for value, n in rows]
    metric = str(args.get("metric") or "")
    if metric:
        spec = resource.fields.by_name.get(str(args.get("metric_field") or ""))
        if spec is None or spec.kind != "number":
            raise ValidationError("metric_field must be a number field.")
        fn = {"sum": func.sum, "avg": func.avg, "min": func.min, "max": func.max}.get(metric)
        if fn is None:
            raise ValidationError("metric must be sum, avg, min or max.")
        value = session.scalar(statement.with_only_columns(fn(spec.expression)).order_by(None))
        out["metric"] = {"op": metric, "field": spec.name, "value": explorer._json_value(value)}
    return out, []


def get_record(session, args: dict[str, Any], *, principal):
    resource = explorer.resource_for(args.get("dataset"), principal=principal)
    detail = records.detail(session, resource.key, args.get("id"), principal=principal)
    fields = {f["name"]: f["value"] for f in detail["fields"] if f["value"] not in (None, "", [])}
    return ({"dataset": resource.key, "id": detail["id"], "title": detail["title"], "fields": fields},
            [_cite(resource, detail["id"], detail["title"])])


def global_search(session, args: dict[str, Any], *, principal):
    result = search.search(session, {"q": str(args.get("text") or ""), "per_resource": 5}, principal=principal)
    cites, groups = [], []
    for group in result["groups"]:
        resource = explorer.resources()[group["resource_type"]]
        items = []
        for item in group["items"]:
            items.append({"id": item["id"], "label": item["label"], "summary": item["summary"]})
            cites.append(_cite(resource, item["id"], item["label"]))
        groups.append({"dataset": group["resource_type"], "items": items})
    return {"query": result["query"], "total": result["total"], "groups": groups}, cites


TOOLS = {
    "search_records": search_records,
    "count_records": count_records,
    "get_record": get_record,
    "global_search": global_search,
}


def search_documents(session, args: dict[str, Any], *, principal, sources: dict[str, Any] | None = None):
    """Passages from the chosen collections (or files), as the reader may see them."""
    from uuid import UUID

    from src.services.knowledge import collections as knowledge

    sources = sources or {}
    query = str(args.get("query") or "").strip()
    if not query:
        raise ValidationError("Say what to look for.")
    visible = set(knowledge.visible_ids(session, principal))
    chosen = [UUID(str(c)) for c in sources.get("collections") or [] if UUID(str(c)) in visible]
    if not chosen:
        raise ValidationError("None of the chosen collections is visible to you any more.")
    files = {str(d) for d in sources.get("documents") or []}
    hits = knowledge.search(session, chosen, query, limit=20)
    if files:
        hits = [h for h in hits if h["document_id"] in files]
    hits = hits[:6]
    passages, cites = [], []
    for index, hit in enumerate(hits, start=1):
        where = hit["file_name"] + (f", page {hit['page']}" if hit["page"] else "")
        passages.append({"ref": f"D{index}", "where": where, "text": hit["text"][:1500]})
        cites.append({
            "resource_type": "document", "id": hit["chunk_id"], "dataset": "Documents",
            "label": f"[D{index}] {hit['file_name']}" + (f" · p. {hit['page']}" if hit["page"] else ""),
            "path": f"/ai/documents?collection={hit['collection_id']}&passage={hit['chunk_id']}",
        })
    return {"query": query, "total": len(passages), "passages": passages}, cites


def run(session, name: str, args: dict[str, Any], *, principal,
        sources: dict[str, Any] | None = None) -> tuple[str, list[dict[str, str]], str]:
    """Execute one tool call: (JSON for the model, citations, a one-line summary).

    A refusal or a bad argument goes back to the model as an error it can
    correct — never as an exception that ends the conversation."""
    if name == "search_documents":
        tool = lambda s, a, principal: search_documents(s, a, principal=principal, sources=sources)  # noqa: E731
    else:
        tool = TOOLS.get(name)
    if tool is None:
        return json.dumps({"error": f"unknown tool {name}"}), [], f"Unknown tool {name}"
    if not isinstance(args, dict) or "__invalid_json__" in args:
        return json.dumps({"error": "arguments must be a JSON object"}), [], "Unreadable arguments"
    try:
        payload, cites = tool(session, args, principal=principal)
    except ApiError as exc:
        return json.dumps({"error": exc.message or exc.code, "details": exc.details}, default=str), [], \
            f"{name} refused: {exc.message or exc.code}"[:200]
    except (TypeError, ValueError) as exc:
        return json.dumps({"error": str(exc)[:200]}), [], f"{name} failed"
    return json.dumps(payload, default=str)[:12000], cites, _summary(name, payload)


def _summary(name: str, payload: dict[str, Any]) -> str:
    if name == "search_records":
        return f"Found {payload['total']} in {payload['dataset']}" + (f" where {payload['condition']}" if payload["condition"] else "")
    if name == "count_records":
        extra = f", by {payload['by']}" if payload.get("by") else ""
        return f"Counted {payload['total']} in {payload['dataset']}{extra}"
    if name == "get_record":
        return f"Read {payload['title']}"
    if name == "search_documents":
        return f"Read {payload['total']} passages for “{payload['query']}”"
    return f"Searched everything for “{payload['query']}” — {payload['total']} hits"
