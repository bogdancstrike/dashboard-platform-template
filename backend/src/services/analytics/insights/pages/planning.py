"""Planning an insight from a question or a suggestion, without the model."""

from __future__ import annotations

import json
import re
from typing import Any

from src.core.clock import iso, now
from src.core.repository import found_or_404
from src.services.analytics.insights import spec as specs
from src.services.analytics.insights import suggestions as suggestions
from src.services.analytics.insights.pages.tools import USE_PERMISSION
from src.services.records import explorer

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
