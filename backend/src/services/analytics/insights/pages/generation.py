"""Generating an insight by asking the model."""

from __future__ import annotations

import json
from typing import Any

from src.core import llm
from src.core.clock import iso, now
from src.core.errors import ValidationError
from src.services.ai import usage as ai
from src.services.analytics.insights import spec as specs
from src.services.analytics.insights.pages.planning import plan
from src.services.analytics.insights.pages.tools import (
    FEATURE,
    MAX_QUESTION,
    MAX_ROUNDS,
    SYSTEM_PROMPT,
    TOOLS,
    _catalogue,
    _run_tool,
)


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
