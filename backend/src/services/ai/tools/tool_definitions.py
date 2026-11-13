"""The tools the assistant may call, and searching records."""

from __future__ import annotations

from typing import Any

from src.services.ai import filters as ai_filters
from src.services.records import explorer

MAX_ROWS = 20


def _datasets(principal) -> list[Any]:
    return [r for r in explorer.resources().values() if principal.can(r.permission)]


def catalogue_text(principal) -> str:
    """The datasets this person may read, for the system prompt."""
    blocks = []
    for res in _datasets(principal):
        blocks.append(f"### {res.key} — {res.label} (open one at {res.path}/<id>)\n{ai_filters.field_catalogue(res)}")
    return "\n\n".join(blocks) or "(no datasets are readable by this user)"


DOCUMENT_TOOL = {"type": "function", "function": {
    "name": "search_documents",
    "description": "Search the document collections chosen as sources (passages of PDFs, Word files, notes...). "
                   "Returns numbered passages with file name and page; cite them as [D1], [D2] in the answer.",
    "parameters": {"type": "object", "required": ["query"], "properties": {
        "query": {"type": "string", "description": "What to look for, in the words a passage would use."},
    }},
}}


def definitions(principal, sources: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    """The tools a Data-mode turn may call, for the sources it was given."""
    sources = sources or {}
    records = record_definitions(principal) if sources.get("records", True) else []
    return records + ([DOCUMENT_TOOL] if sources.get("collections") else [])


def record_definitions(principal) -> list[dict[str, Any]]:
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
    columns = list(dict.fromkeys([c for c in ("reference", "code", "serial", resource.title_field,
                                              resource.subtitle_field, resource.status_field)
                                  if c and c in resource.fields.by_name] + list(resource.default_columns)))[:9]
    payload: dict[str, Any] = {"resource_type": resource.key, "condition_tree": tree, "page_size": limit,
                               "columns": columns, "query_text": str(args.get("text") or "")}
    sort = str(args.get("sort") or "")
    if sort in resource.fields.by_name:
        payload["sort"] = sort
        payload["order"] = "asc" if args.get("order") == "asc" else "desc"
    result = explorer.run(session, payload, principal=principal)
    rows, cites = [], []
    for item in result["items"]:
        ref = next((item.get(n) for n in ("reference", "code", "serial") if item.get(n)), None)
        label = str(ref or item.get(resource.title_field) or item.get(resource.subtitle_field) or item["id"])
        rows.append({k: v for k, v in item.items() if v not in (None, "", [])})
        cites.append(_cite(resource, item["id"], label))
    return {"dataset": resource.key, "total": result["total"], "shown": len(rows),
            "condition": result.get("condition_text") or "", "rows": rows}, cites
