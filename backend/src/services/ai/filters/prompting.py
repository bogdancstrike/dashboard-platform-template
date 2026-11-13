"""The field catalogue, schema and prompt the model is given, and the heuristic fallback."""

from __future__ import annotations

import re
from typing import Any

from src.core.clock import now
from src.core.query import OPERATORS_BY_KIND
from src.services.records import explorer


def field_catalogue(resource) -> str:
    """One line per field: what the model may name, and how it compares."""
    lines = []
    for spec in resource.fields.fields:
        if not spec.filterable:
            continue
        line = f"- {spec.name} ({spec.title}; {spec.kind}"
        ref = explorer.references_of(spec) if spec.kind == "uuid" else ""
        if ref:
            line += f"; refers to a {ref} — write a name, or @me for the reader"
        if spec.choices:
            line += "; one of " + ", ".join(spec.choices)
        line += "; operators " + ", ".join(sorted(OPERATORS_BY_KIND.get(spec.kind, ())))
        lines.append(line + ")")
    return "\n".join(lines)


TREE_SCHEMA = """The tree is JSON, exactly this shape (react-awesome-query-builder):
{"type":"group","properties":{"conjunction":"AND"|"OR","not":false},"children1":[ <node>, ... ]}
where each <node> is either another group of the same shape, or a rule:
{"type":"rule","properties":{"field":"<field name>","operator":"<operator>","value":[<value>]}}
Value lists: one entry normally; two for "between" ([from, to]); [[a, b, ...]] for "in"/"not_in";
[] for empty/not_empty. Dates are "YYYY-MM-DD HH:mm:ss" (or today, +7d, -30d relative to today).
Use groups to express precedence: "A and (B or C)" is an AND group holding A and an OR group of B and C."""


def system_prompt(resource, *, principal, datasets: list[Any] | None = None) -> str:
    today = now().strftime("%A %Y-%m-%d")
    parts = [
        "You turn a question about business records into a filter for the Nucleus Data Explorer.",
        f"Today is {today}. The reader is {principal.full_name}; \"me\", \"my\", \"mine\" mean @me.",
        TREE_SCHEMA,
    ]
    if datasets:
        parts.append("Datasets you may choose from (pick the one the question is about):")
        for res in datasets:
            parts.append(f"\n## {res.key} — {res.label}: {res.description}\n{field_catalogue(res)}")
        parts.append(
            'Answer with JSON only: {"resource_type":"<dataset key>","tree":<tree>,'
            '"explanation":"<one sentence in plain words>"}'
        )
    else:
        parts.append(f"Dataset: {resource.key} — {resource.label}. Fields:\n{field_catalogue(resource)}")
        parts.append('Answer with JSON only: {"tree":<tree>,"explanation":"<one sentence in plain words>"}')
    parts.append(
        "Use only the fields and operators listed. Never invent a field. If part of the question cannot be "
        "expressed with these fields, leave it out and say so in the explanation."
    )
    return "\n\n".join(parts)


def heuristic_tree(question: str, resource, *, principal) -> dict[str, Any]:
    """A best effort from the words alone, for when no model is configured or
    it answered with nothing usable: choices named in the question, "my", and
    "overdue"."""
    text = f" {question.lower()} "
    children: list[dict[str, Any]] = []
    for spec in resource.fields.fields:
        if spec.kind != "enum" or not spec.choices:
            continue
        named = [c for c in spec.choices if re.search(rf"\b{re.escape(c.lower().replace('_', ' '))}\b", text)]
        if named:
            children.append({"type": "rule", "properties": {"field": spec.name, "operator": "in", "value": [named]}})
    if re.search(r"\b(my|mine|me|assigned to me)\b", text):
        for name in ("assignee_id", "owner_id", "account_manager_id"):
            if name in resource.fields.by_name:
                children.append({"type": "rule", "properties": {"field": name, "operator": "eq", "value": ["@me"]}})
                break
    if "overdue" in text or "past due" in text:
        due = next((n for n in ("due_date", "due_at") if n in resource.fields.by_name), None)
        if due:
            children.append({"type": "rule", "properties": {"field": due, "operator": "lt", "value": ["today"]}})
    return {"type": "group", "properties": {"conjunction": "AND"}, "children1": children}
