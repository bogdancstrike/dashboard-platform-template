"""Compiling a question into a condition tree."""

from __future__ import annotations

from typing import Any

from src.core import llm
from src.core.errors import ValidationError
from src.core.rules import describe_tree, rule_count
from src.services.ai import usage as ai
from src.services.ai.filters.prompting import heuristic_tree, system_prompt
from src.services.ai.filters.tree_shape import normalise
from src.services.ai.filters.vocabulary import FEATURE, MAX_QUESTION
from src.services.records import explorer


def compile_question(session, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise ValidationError("The request must be a JSON object.")
    question = str(payload.get("question") or "").strip()
    if not question:
        raise ValidationError("Describe what you want to find.", details={"field": "question"})
    if len(question) > MAX_QUESTION:
        raise ValidationError(f"Keep the description under {MAX_QUESTION} characters.")
    ai.guard(session, principal, FEATURE)

    requested = str(payload.get("resource_type") or "").strip()
    choosing = requested in ("", "auto")
    allowed = [r for r in explorer.resources().values() if principal.can(r.permission)]
    if not allowed:
        principal.require("records.view")
    resource = allowed[0] if choosing else explorer.resource_for(requested, principal=principal)

    client = llm.get_client()
    messages = [
        {"role": "system", "content": system_prompt(resource, principal=principal, datasets=allowed if choosing else None)},
    ]
    current = payload.get("current_tree")
    if isinstance(current, dict) and rule_count(current) and not choosing:
        messages.append({"role": "user", "content": "The filter currently applied (refine it if the request builds on it):\n"
                         + _json(current)})
    messages.append({"role": "user", "content": question})

    source = "ai"
    explanation = ""
    raw_tree: Any = None
    try:
        result = client.chat(messages, json_mode=True, max_tokens=1500, user=str(principal.user_id))
    except llm.LlmError as exc:
        ai.record_usage(session, principal, FEATURE, status="error")
        if exc.code not in ("LLM_UNAVAILABLE", "LLM_TIMEOUT", "LLM_AUTH", "LLM_BUSY"):
            raise ai.unavailable(exc) from exc
        result = None
    if result is not None:
        ai.record_usage(session, principal, FEATURE, result.usage, model=result.model)
        try:
            answer = result.json()
        except llm.LlmError:
            answer = {}
        if isinstance(answer, dict):
            raw_tree = answer.get("tree") or (answer if answer.get("type") else None)
            explanation = str(answer.get("explanation") or "")[:400]
            if choosing and answer.get("resource_type"):
                picked = explorer.resources().get(str(answer["resource_type"]))
                if picked is not None and principal.can(picked.permission):
                    resource = picked
    if not raw_tree or not rule_count(raw_tree):
        raw_tree = heuristic_tree(question, resource, principal=principal)
        source = "fallback"
        explanation = explanation or "Built from the words in your description."

    tree, notes = normalise(raw_tree, resource, session=session, principal=principal)
    if not rule_count(tree) and source == "ai":
        # Everything the model wrote was unusable: the words are better than nothing.
        tree, more = normalise(heuristic_tree(question, resource, principal=principal), resource,
                               session=session, principal=principal)
        notes, source = notes + more, "fallback"
    total = rule_count(tree)
    preview = explorer.run(session, {"resource_type": resource.key, "condition_tree": tree, "page_size": 1},
                           principal=principal) if total else None
    ai.audit(session, principal, resource_type="ai_filters", label=f"Described a {resource.label.lower()} filter",
             metadata={"question": question[:300], "rules": total, "source": source, "resource_type": resource.key})
    return {
        "resource_type": resource.key,
        "tree": tree,
        "explanation": explanation,
        "notes": notes,
        "rule_count": total,
        "match_count": preview["total"] if preview else None,
        "condition_text": describe_tree(tree, resource.fields),
        "source": source,
    }


def _json(value: Any) -> str:
    import json

    return json.dumps(value, default=str)[:4000]
