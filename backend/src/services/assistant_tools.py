"""The read-only tools a Data-mode conversation may call (§41).

Every tool goes through the service the UI itself uses — the explorer's
query, the record page's detail, global search — with the *caller's*
principal, so the assistant can never read a row its user could not open
themselves. Nothing here writes.

Each tool returns ``(payload, citations)``: what the model reads back (kept
small — rows are trimmed to the fields that identify them), and the records
it was shown, which the answer cites with links.
"""

from __future__ import annotations

import json
from typing import Any

from sqlalchemy import func

from src.core.errors import ApiError, ValidationError
from src.core.query import apply_filters
from src.core.rules import compile_tree, describe_tree
from src.services import ai_filters, explorer, records, search

MAX_ROWS = 20


def _datasets(principal) -> list[Any]:
    return [r for r in explorer.resources().values() if principal.can(r.permission)]


def catalogue_text(principal) -> str:
    """The datasets this person may read, for the system prompt."""
    blocks = []
    for res in _datasets(principal):
        blocks.append(f"### {res.key} — {res.label} (open one at {res.path}/<id>)\n{ai_filters.field_catalogue(res)}")
    return "\n\n".join(blocks) or "(no datasets are readable by this user)"


def definitions(principal) -> list[dict[str, Any]]:
    keys = [r.key for r in _datasets(principal)]
    tree = {
        "type": "object",
        "description": "Optional condition tree, exactly the explorer's shape (see the system prompt).",
        "additionalProperties": True,
    }
    return [
        {"type": "function", "function": {
            "name": "search_records",
            "description": "Find records in one dataset: free text and/or a condition tree. Returns the matching "
                           "rows (id, title, status and the dataset's key columns) and the total count.",
            "parameters": {"type": "object", "required": ["dataset"], "properties": {
                "dataset": {"type": "string", "enum": keys},
                "text": {"type": "string", "description": "Free-text search across the searchable fields."},
                "condition_tree": tree,
                "sort": {"type": "string", "description": "A field name to sort by."},
                "order": {"type": "string", "enum": ["asc", "desc"]},
                "limit": {"type": "integer", "minimum": 1, "maximum": MAX_ROWS},
            }},
        }},
        {"type": "function", "function": {
            "name": "count_records",
            "description": "Count records in one dataset matching optional conditions; optionally broken down by a "
                           "field (top values with counts), and/or a sum/avg/min/max of a number field.",
            "parameters": {"type": "object", "required": ["dataset"], "properties": {
                "dataset": {"type": "string", "enum": keys},
                "text": {"type": "string"},
                "condition_tree": tree,
                "group_by": {"type": "string", "description": "A field name to break the count down by."},
                "metric": {"type": "string", "enum": ["sum", "avg", "min", "max"]},
                "metric_field": {"type": "string", "description": "The number field the metric applies to."},
            }},
        }},
        {"type": "function", "function": {
            "name": "get_record",
            "description": "Every field of one record, by dataset and id.",
            "parameters": {"type": "object", "required": ["dataset", "id"], "properties": {
                "dataset": {"type": "string", "enum": keys},
                "id": {"type": "string"},
            }},
        }},
        {"type": "function", "function": {
            "name": "global_search",
            "description": "Search every dataset at once for a word or name; returns the best hits per dataset.",
            "parameters": {"type": "object", "required": ["text"], "properties": {
                "text": {"type": "string"},
            }},
        }},
    ]


def _cite(resource, row_id: str, label: str) -> dict[str, str]:
    return {"resource_type": resource.key, "id": row_id, "label": label[:160],
            "path": f"{resource.path}/{row_id}", "dataset": resource.label}


def _tree(session, resource, raw: Any, principal) -> dict[str, Any] | None:
    if not raw:
        return None
    tree, _ = ai_filters.normalise(raw, resource, session=session, principal=principal)
    return tree


def search_records(session, args: dict[str, Any], *, principal):
    resource = explorer.resource_for(args.get("dataset"), principal=principal)
    tree = _tree(session, resource, args.get("condition_tree"), principal)
    limit = max(1, min(int(args.get("limit") or 10), MAX_ROWS))
    columns = list(dict.fromkeys([c for c in (resource.title_field, resource.subtitle_field, resource.status_field)
                                  if c and c in resource.fields.by_name] + list(resource.default_columns)))[:8]
    payload: dict[str, Any] = {"resource_type": resource.key, "condition_tree": tree, "page_size": limit,
                               "columns": columns, "query_text": str(args.get("text") or "")}
    sort = str(args.get("sort") or "")
    if sort in resource.fields.by_name:
        payload["sort"] = sort
        payload["order"] = "asc" if args.get("order") == "asc" else "desc"
    result = explorer.run(session, payload, principal=principal)
    rows, cites = [], []
    for item in result["items"]:
        label = str(item.get(resource.title_field) or item.get(resource.subtitle_field) or item["id"])
        rows.append({k: v for k, v in item.items() if v not in (None, "", [])})
        cites.append(_cite(resource, item["id"], label))
    return {"dataset": resource.key, "total": result["total"], "shown": len(rows),
            "condition": result.get("condition_text") or "", "rows": rows}, cites


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


def run(session, name: str, args: dict[str, Any], *, principal) -> tuple[str, list[dict[str, str]], str]:
    """Execute one tool call: (JSON for the model, citations, a one-line summary).

    A refusal or a bad argument goes back to the model as an error it can
    correct — never as an exception that ends the conversation."""
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
    return f"Searched everything for “{payload['query']}” — {payload['total']} hits"
