"""The tools the model may call while building an insight, and its prompt."""

from __future__ import annotations

import json
from typing import Any

from src.core import llm
from src.core.errors import ValidationError
from src.services.analytics import analysis
from src.services.analytics.insights import spec as specs
from src.services.records import explorer

USE_PERMISSION = "ai.use"


SHARE_PERMISSION = "searches.share"


KIND = "insight"


FEATURE = "insights"


MAX_ROUNDS = 3


MAX_QUESTION = 500


TOOL_RESULT_CHARS = 6000


def _catalogue(principal) -> list[dict[str, Any]]:
    out = []
    for item in analysis.catalogue(principal=principal)["datasets"]:
        resource = explorer.resources()[item["key"]]
        out.append({
            "dataset": item["key"],
            "label": item["label"],
            "group_by": [
                {"field": d["name"], **({"values": d["choices"][:12]} if d["choices"] else {})}
                for d in item["dimensions"]
                if d["kind"] in ("enum", "bool", "datetime") or d["name"] in ("industry", "country", "city", "location", "model", "manufacturer", "category", "channel")
            ],
            "measures": [m["name"] for m in item["measures"]],
            "dates": [d["name"] for d in item["dates"]],
            "default_date": item["default_date"],
            "record_columns": [f.name for f in resource.fields.fields if f.kind != "uuid"][:24],
        })
    return out


REGISTRY_DOC = """Components (use only these; anything else is dropped):
- kpi: {label, format?, hint?, compare?: bool (delta vs previous period; needs a period), query}
- bar | line | area | pie: {title, format?, stacked?, horizontal? (bar), query with 1-2 dimensions}
- table: {title, query (grouped) OR records}
- list: {title, records} — rows of records with a link each
- comparison: {title, format?, query with 1 dimension}
- progress: {label, value or query, max: number, format?}
- timeline: {title, records with sort = a date field, date_field}
- markdown: {text} — short narrative; may use **bold** and bullet lists
- callout: {tone: info|success|warning|danger, title, text}
- section: {title, blocks: [...]} (one level)
Every component may set width: full | half | third. format: number | currency | percent | duration.
query (aggregation): {dataset, dimensions: [field | {field, granularity: day|week|month|quarter|year}],
  measures: ["count" | {aggregation: sum|avg|min|max|count, field}], period?: last_7_days|last_30_days|
  last_90_days|last_180_days|last_365_days, date_field?, filters?: {field: "VALUE1,VALUE2"}, limit?}
records: {dataset, columns: [...], sort: field, order: asc|desc, filters?, limit (<=20)}"""


SYSTEM_PROMPT = f"""You build small analytical pages ("insights") that answer a question about the user's business
records. You may call run_analysis and list_records (read-only) to look at the data first, at most a few times.
Then answer with ONLY a JSON object: {{"title": str, "summary": str, "blocks": [components]}}.

{REGISTRY_DOC}

Rules:
- Data-bearing components must carry a query or records spec — never type numbers into them; the server runs the
  queries as the viewer and fills the data in.
- 3 to 8 components: usually 2-3 KPIs (width third) first, then 1-3 charts, then a table or list.
- Use a line or area chart over a date dimension with a granularity for trends, bar for categories, pie only for
  <= 6 categories. Use filters with the exact enum values listed in the catalogue.
- A markdown or callout component may state what you observed with the tools, in one or two sentences.
- Never invent datasets or fields; use only those in the catalogue."""


TOOLS = [
    {"type": "function", "function": {
        "name": "run_analysis",
        "description": "Group and measure a dataset (aggregated in the database). Returns rows and totals.",
        "parameters": {"type": "object", "properties": {
            "dataset": {"type": "string"},
            "dimensions": {"type": "array", "items": {}},
            "measures": {"type": "array", "items": {}},
            "period": {"type": "string"},
            "filters": {"type": "object"},
            "limit": {"type": "integer"},
        }, "required": ["dataset"]}}},
    {"type": "function", "function": {
        "name": "list_records",
        "description": "A few records of a dataset, with chosen columns.",
        "parameters": {"type": "object", "properties": {
            "dataset": {"type": "string"},
            "columns": {"type": "array", "items": {"type": "string"}},
            "sort": {"type": "string"},
            "order": {"type": "string", "enum": ["asc", "desc"]},
            "filters": {"type": "object"},
            "limit": {"type": "integer"},
        }, "required": ["dataset"]}}},
]


def _run_tool(session, call: llm.ToolCall, principal) -> str:
    args = call.arguments if isinstance(call.arguments, dict) else {}
    try:
        if call.name == "run_analysis":
            query = specs._query({**args, "dataset": args.get("dataset")}) or {}
            if not query:
                raise ValidationError("Name a dataset.")
            result = analysis.run(session, specs._analysis_payload(query), principal=principal)
            body = {"description": result["description"], "matched": result["matched"], "totals": result["totals"],
                    "rows": [{"keys": r["keys"], "values": r["values"]} for r in result["rows"][:30]]}
        elif call.name == "list_records":
            records = specs._records({**args, "limit": min(int(args.get("limit") or 5), 10)}) or {}
            if not records:
                raise ValidationError("Name a dataset.")
            node = {"type": "table", "records": records}
            data = specs._bind_records(session, node, principal)
            body = {"matched": data["matched"], "rows": [{k: v for k, v in row.items() if k != "href"} for row in data["rows"]]}
        else:
            body = {"error": f"unknown tool {call.name}"}
    except Exception as exc:  # noqa: BLE001 - the model is told what went wrong and may try again
        body = {"error": str(getattr(exc, "message", exc))[:300]}
    return json.dumps(body, default=str)[:TOOL_RESULT_CHARS]
