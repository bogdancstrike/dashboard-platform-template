"""Insights (§43): ask a question about the records, get a small page back.

**How a page is made.** The model is given the registry of components (see
`services/insight_spec`), the datasets this reader may read with their
groupable fields and measures, and two read-only tools: `run_analysis` (the
same aggregation the analytics workspace uses) and `list_records` (the
explorer's query). It looks, then answers with a JSON spec whose data-bearing
components carry *queries*. The spec is validated against the registry and
the queries are executed as the reader — so a component can never show a
number the reader could not have queried themselves, and the model never
touches the database or writes a number into a chart.

**Cost is bounded.** At most `MAX_ROUNDS` tool rounds and one final answer
per question, every call through `core/llm` (with its time and concurrency
caps) and the shared per-user rate limit (`services/ai.guard`). Without a
model — no key, `LLM_MODE=fake`, or a model that fails — a deterministic
planner picks the dataset the question names and composes a sensible page, so
the feature degrades to useful rather than to an error.

**Refresh is free.** A saved insight keeps its spec; refreshing re-binds the
queries and stores the new numbers. Pinning, sharing (the platform's one
sharing model) and putting it on a dashboard work from the saved row.
"""

from __future__ import annotations

import json
import re
from typing import Any

from sqlalchemy import and_, or_, select

from src.core import audit, llm, sharing
from src.core.clock import iso, now
from src.core.errors import ValidationError
from src.core.pagination import parse_uuid
from src.core.repository import found_or_404
from src.services.ai import usage as ai
from src.services.analytics import analysis
from src.services.records import explorer
from src.services.analytics.insights import spec as specs
from src.services.analytics.insights import suggestions as suggestions

USE_PERMISSION = "ai.use"
SHARE_PERMISSION = "searches.share"
KIND = "insight"
FEATURE = "insights"
MAX_ROUNDS = 3
MAX_QUESTION = 500
TOOL_RESULT_CHARS = 6000


# ── generating ───────────────────────────────────────────────────────────


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


def generate(session, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    """A draft insight for a question — composed, validated and bound; not saved."""
    payload = payload if isinstance(payload, dict) else {}
    question = str(payload.get("question") or "").strip()
    if not question:
        raise ValidationError("Ask a question about your data.", details={"field": "question"})
    if len(question) > MAX_QUESTION:
        raise ValidationError(f"A question is at most {MAX_QUESTION} characters.")
    ai.guard(session, principal, FEATURE)
    catalogue = _catalogue(principal)
    if not catalogue:
        raise ValidationError("You may not read any dataset an insight could use.")

    client = llm.get_client()
    warnings: list[str] = []
    usage = llm.Usage()
    model = None
    source = "ai"
    spec = None
    if getattr(client, "is_fake", False) and not getattr(client, "script", None):
        spec, source = plan(question, catalogue), "fallback"
    else:
        status = "ok"
        try:
            raw, usage, model = _ask_model(session, client, question, catalogue, principal)
            spec, dropped = specs.validate(raw)
            warnings.extend(dropped)
        except llm.LlmError as exc:
            status = "error"
            if exc.code in ("LLM_RATE_LIMITED", "LLM_BUSY"):
                ai.record_usage(session, principal, FEATURE, usage, status=status)
                raise ai.unavailable(exc) from exc
            warnings.append("The AI model was not available, so this page was composed without it.")
            spec, source = plan(question, catalogue), "fallback"
        except specs.SpecError as exc:
            warnings.append(f"The model's page could not be used ({exc}); this one was composed without it.")
            spec, source = plan(question, catalogue), "fallback"
        ai.record_usage(session, principal, FEATURE, usage, model=model, status=status)

    validated, dropped = specs.validate(spec)
    rendered, errors = specs.bind(session, validated, principal=principal)
    ai.audit(session, principal, resource_type="insight", label=f"insight: {question[:200]}",
             metadata={"source": source, "datasets": specs.queries_of(validated)})
    return {
        "id": None,
        "question": question,
        "title": validated["title"],
        "summary": validated["summary"],
        "spec": validated,
        "rendered": rendered,
        "warnings": warnings + dropped + errors,
        "source": source,
        "model": model,
        "usage": usage.to_dict() if source == "ai" else None,
        "refreshed_at": iso(now()),
    }


def _ask_model(session, client, question: str, catalogue: list[dict[str, Any]], principal):
    messages: list[dict[str, Any]] = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": "Catalogue of datasets you may use:\n" + json.dumps(catalogue, separators=(",", ":"))
                                    + f"\n\nQuestion: {question}"},
    ]
    total = llm.Usage()
    model = None
    for _round in range(MAX_ROUNDS):
        result = client.chat(messages, tools=TOOLS, user=str(principal.user_id), max_tokens=2500)
        total = total.add(result.usage)
        model = result.model or model
        if not result.tool_calls:
            if result.text.strip().startswith("{") or "```" in result.text:
                return llm.parse_json(result.text), total, model
            break
        messages.append(result.assistant_message())
        for call in result.tool_calls[:4]:
            messages.append({"role": "tool", "tool_call_id": call.id, "content": _run_tool(session, call, principal)})
    messages.append({"role": "user", "content": "Now answer with only the JSON page."})
    final = client.chat(messages, json_mode=True, user=str(principal.user_id), max_tokens=3000)
    total = total.add(final.usage)
    return final.json(), total, final.model or model


# ── the planner used without a model ─────────────────────────────────────

_WORDS = {
    "order": ("order", "sale", "sales", "revenue", "purchase", "channel", "payment", "shipping", "ship"),
    "ticket": ("ticket", "support", "sla", "incident", "satisfaction", "csat", "helpdesk", "issue"),
    "project": ("project", "portfolio", "budget", "milestone", "health", "spend", "spent"),
    "customer": ("customer", "client", "account", "segment", "industry", "lifetime", "country"),
    "task": ("task", "work", "team", "blocked", "assignee", "backlog", "hours"),
    "device": ("device", "fleet", "battery", "sensor", "uptime", "error", "hardware"),
}


def plan(question: str, catalogue: list[dict[str, Any]]) -> dict[str, Any]:
    """A deterministic page for a question: the dataset it names, composed sensibly."""
    words = set(re.findall(r"[a-z]+", question.lower()))
    allowed = {item["dataset"]: item for item in catalogue}
    scores = {
        dataset: sum(1 for w in words for hint in hints if w.startswith(hint))
        for dataset, hints in _WORDS.items() if dataset in allowed
    }
    dataset = max(scores, key=lambda key: scores[key]) if scores and max(scores.values()) > 0 else next(iter(allowed))
    canned = suggestions.SUGGESTIONS.get(dataset)
    if canned:
        spec = json.loads(json.dumps(canned[0]["spec"]))
        spec["summary"] = spec.get("summary") or f"A first look at {allowed[dataset]['label'].lower()}."
        return spec
    item = allowed[dataset]  # pragma: no cover - every dataset has a suggestion today
    groups = [g["field"] for g in item["group_by"] if "values" in g]
    return {  # pragma: no cover
        "title": item["label"],
        "blocks": [
            {"type": "kpi", "label": item["label"], "query": {"dataset": dataset, "measures": ["count"]}},
            *([{"type": "bar", "title": f"By {groups[0]}", "query": {"dataset": dataset, "dimensions": [groups[0]]}}]
              if groups else []),
            {"type": "table", "title": "Latest", "records": {"dataset": dataset, "limit": 8}},
        ],
    }


def from_suggestion(session, key: str, *, principal) -> dict[str, Any]:
    """A suggested insight, bound for this reader — instant, and no model."""
    principal.require(USE_PERMISSION)
    item = found_or_404(
        suggestions.find(key), "That suggestion does not exist.", details={"key": key}
    )
    explorer.resource_for(item["dataset"], principal=principal)
    validated, dropped = specs.validate(item["spec"])
    rendered, errors = specs.bind(session, validated, principal=principal)
    return {"id": None, "question": item["question"], "title": validated["title"], "summary": validated["summary"],
            "spec": validated, "rendered": rendered, "warnings": dropped + errors, "source": "suggested",
            "model": None, "usage": None, "refreshed_at": iso(now())}


# ── saved insights ───────────────────────────────────────────────────────


def _visible(principal):
    from src.models.insights import Insight

    return and_(Insight.deleted_at.is_(None), sharing.visibility(Insight, KIND, principal))


def _row(session, ident: Any, principal):
    from src.models.insights import Insight

    identifier = parse_uuid(ident, field="insight_id")
    row = found_or_404(
        session.scalars(select(Insight).where(Insight.id == identifier, _visible(principal))).first(),
        "That insight does not exist.",
        details={"id": str(identifier)},
    )
    return row


def serialize(row, principal, *, full: bool = True, members=None) -> dict[str, Any]:
    out = {
        "id": str(row.id),
        "title": row.title,
        "question": row.question,
        "summary": row.summary or "",
        "datasets": list(row.datasets or []),
        "source": row.source,
        "model": row.model,
        "scope": row.scope,
        "pinned": bool(row.pinned),
        "owner": {"id": str(row.owner_id) if row.owner_id else None, "name": row.owner.full_name if row.owner else ""},
        "can_edit": row.owner_id == principal.user_id,
        "refreshed_at": iso(row.refreshed_at),
        "created_at": iso(row.created_at),
        "updated_at": iso(row.updated_at),
        "kinds": [node["type"] for node in (row.spec or {}).get("blocks", [])][:12],
    }
    if full:
        out.update({"spec": row.spec, "rendered": row.rendered, "warnings": list(row.warnings or [])})
    if members is not None:
        out["members"] = members
    return out


def listing(session, args: dict[str, Any], *, principal) -> dict[str, Any]:
    from src.models.insights import Insight

    principal.require(USE_PERMISSION)
    statement = select(Insight).where(_visible(principal))
    text = str(args.get("q") or "").strip()
    if text:
        statement = statement.where(or_(Insight.title.ilike(f"%{text}%"), Insight.question.ilike(f"%{text}%")))
    if str(args.get("scope") or "") == "mine":
        statement = statement.where(Insight.owner_id == principal.user_id)
    rows = session.scalars(
        statement.order_by(Insight.pinned.desc(), Insight.updated_at.desc()).limit(200)
    ).unique().all()
    return {
        "items": [serialize(row, principal, full=False) for row in rows],
        "suggestions": suggestions.for_viewer(principal, explorer.resources()),
        "datasets": [{"key": d["dataset"], "label": d["label"]} for d in _catalogue(principal)],
        "can_share": principal.can(SHARE_PERMISSION),
    }


def detail(session, ident: Any, args: dict[str, Any] | None = None, *, principal) -> dict[str, Any]:
    """One insight. `fresh=true` binds its queries now, for this reader, without storing."""
    principal.require(USE_PERMISSION)
    row = _row(session, ident, principal)
    out = serialize(row, principal, members=sharing.members(session, KIND, row.id))
    if str((args or {}).get("fresh") or "").lower() in ("1", "true", "yes"):
        rendered, errors = specs.bind(session, row.spec, principal=principal)
        out.update({"rendered": rendered, "warnings": errors, "refreshed_at": iso(now())})
    return out


def save(session, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    """Keep a draft: its spec is validated and bound again, never trusted."""
    from src.models.insights import Insight

    principal.require(USE_PERMISSION)
    payload = payload if isinstance(payload, dict) else {}
    question = str(payload.get("question") or "").strip()[:MAX_QUESTION]
    if not question:
        raise ValidationError("An insight needs the question it answers.", details={"field": "question"})
    try:
        spec, dropped = specs.validate(payload.get("spec"))
    except specs.SpecError as exc:
        raise ValidationError(str(exc), details={"field": "spec"}) from exc
    title = str(payload.get("title") or spec["title"]).strip()[:200] or "Insight"
    spec["title"] = title
    rendered, errors = specs.bind(session, spec, principal=principal)
    scope = sharing.scope_of(payload.get("scope"), principal=principal, share_permission=SHARE_PERMISSION)
    source = payload.get("source") if payload.get("source") in ("ai", "suggested", "fallback") else "ai"
    row = Insight(title=title, question=question, summary=spec["summary"] or None,
                  datasets=specs.queries_of(spec), spec=spec, rendered=rendered, warnings=dropped + errors or None,
                  source=source, model=str(payload.get("model") or "")[:80] or None,
                  usage=payload.get("usage") if isinstance(payload.get("usage"), dict) else None,
                  scope=scope, pinned=bool(payload.get("pinned")), refreshed_at=now(),
                  owner_id=principal.user_id, organization_id=principal.organization_id)
    session.add(row)
    session.flush()
    if scope == "SHARED":
        sharing.replace_members(session, KIND, row.id, sharing.requested_members(payload),
                                principal=principal, owner_id=row.owner_id)
    audit.record(session, action="CREATE", resource_type="insight", resource_id=row.id, resource_label=title,
                 principal=principal, after={"title": title, "scope": scope}, message=f"saved insight {title}")
    session.flush()
    return detail(session, row.id, principal=principal)


def update(session, ident: Any, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    principal.require(USE_PERMISSION)
    row = _row(session, ident, principal)
    sharing.require_owner(row, principal, kind="insight")
    payload = payload if isinstance(payload, dict) else {}
    before = {"title": row.title, "scope": row.scope, "pinned": row.pinned}
    if "title" in payload:
        title = str(payload.get("title") or "").strip()[:200]
        if not title:
            raise ValidationError("An insight needs a title.", details={"field": "title"})
        row.title = title
        row.spec = {**row.spec, "title": title}
    if "pinned" in payload:
        row.pinned = bool(payload.get("pinned"))
    if "scope" in payload:
        row.scope = sharing.scope_of(payload.get("scope"), current=row.scope, principal=principal,
                                     share_permission=SHARE_PERMISSION)
    if "member_ids" in payload:
        sharing.replace_members(session, KIND, row.id, sharing.requested_members(payload),
                                principal=principal, owner_id=row.owner_id)
    session.flush()
    audit.record(session, action="UPDATE", resource_type="insight", resource_id=row.id, resource_label=row.title,
                 principal=principal, before=before,
                 after={"title": row.title, "scope": row.scope, "pinned": row.pinned},
                 message=f"updated insight {row.title}", activity=False)
    return detail(session, row.id, principal=principal)


def refresh(session, ident: Any, *, principal) -> dict[str, Any]:
    """Re-run the queries and keep the new numbers. The model is not asked."""
    principal.require(USE_PERMISSION)
    row = _row(session, ident, principal)
    rendered, errors = specs.bind(session, row.spec, principal=principal)
    if row.owner_id == principal.user_id:
        row.rendered = rendered
        row.warnings = errors or None
        row.refreshed_at = now()
        session.flush()
        return detail(session, row.id, principal=principal)
    # A reader who is not the owner sees fresh numbers without rewriting the
    # owner's copy with what *they* may see.
    return {**detail(session, row.id, principal=principal), "rendered": rendered, "warnings": errors,
            "refreshed_at": iso(now())}


def remove(session, ident: Any, *, principal) -> dict[str, Any]:
    principal.require(USE_PERMISSION)
    row = _row(session, ident, principal)
    sharing.require_owner(row, principal, kind="insight")
    row.deleted_at = now()
    session.flush()
    audit.record(session, action="DELETE", resource_type="insight", resource_id=row.id, resource_label=row.title,
                 principal=principal, before={"title": row.title}, message=f"removed insight {row.title}")
    return {"id": str(row.id), "deleted": True}
