"""Natural-language questions → the explorer's condition tree (§23, §42).

The model is asked for the *exact* tree the Rules builder edits and
`core/rules.py` compiles — react-awesome-query-builder's JSON: groups with
``properties.conjunction``/``properties.not`` and ``children1``, rules with
``properties.field``/``operator``/``value``. Nothing it writes is trusted:
:func:`normalise` walks the tree against the dataset's own field catalogue and

* resolves a field by name, by label, or by a close spelling — and drops a
  rule whose field does not exist, saying so;
* maps the operator onto one the field's kind allows (``contains`` on a
  choice becomes ``is``), or drops the rule;
* coerces each value to the field's kind: a choice matched case-insensitively,
  a date written as the builder writes it, a number, a yes/no, and a person or
  a record *named* in the question resolved to its id;
* re-spells the operator the way the builder spells it for that kind
  (``select_equals`` for a choice, ``like`` for text), with fresh node ids.

The result is compiled with the same compiler the search uses and counted, so
the UI shows "37 tickets match" before anybody presses Apply.

Data-mode chat tools take the same tree, through the same function — one
validator for every tree a model writes.
"""

from __future__ import annotations

import difflib
import re
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import or_, select

from src.core import llm
from src.core.clock import now
from src.core.errors import ValidationError
from src.core.query import OPERATORS_BY_KIND, Field, canonical_operator
from src.core.rules import MAX_DEPTH, MAX_RULES, compile_tree, describe_tree, rule_count
from src.services import ai
from src.services import explorer

FEATURE = "filters"
MAX_QUESTION = 600

# ── The builder's spelling of each operator, per builder type ─────────────
# Mirrors `OPERATOR_BY_TYPE` in frontend/src/components/explorer/
# queryBuilderConfig.ts: the tree handed back must be one the Rules builder
# can render without an empty operator dropdown.

BUILDER_TYPE = {
    "text": "text", "uuid": "text", "json": "text", "array": "text",
    "enum": "select", "bool": "boolean", "number": "number", "datetime": "datetime",
}
_PRESENCE_EMPTY = {"empty": "is_empty", "not_empty": "is_not_empty", "exists": "is_not_empty", "not_exists": "is_empty"}
_PRESENCE_NULL = {"empty": "is_null", "not_empty": "is_not_null", "exists": "is_not_null", "not_exists": "is_null"}
_EQUALITY = {"eq": "equal", "ne": "not_equal"}
_ORDERING = {"gt": "greater", "after": "greater", "gte": "greater_or_equal", "lt": "less", "before": "less",
             "lte": "less_or_equal", "between": "between"}
_MEMBERSHIP = {"in": "select_any_in", "not_in": "select_not_any_in"}
BUILDER_OPERATOR: dict[str, dict[str, str]] = {
    "text": {**_EQUALITY, "contains": "like", "not": "not_like", "starts": "starts_with", "ends": "ends_with",
             **_MEMBERSHIP, **_PRESENCE_EMPTY},
    "select": {"eq": "select_equals", "ne": "select_not_equals", **_MEMBERSHIP, **_PRESENCE_NULL},
    "boolean": {**_EQUALITY, **_PRESENCE_NULL},
    "number": {**_EQUALITY, **_ORDERING, **_MEMBERSHIP, **_PRESENCE_NULL},
    "datetime": {**_EQUALITY, **_ORDERING, **_PRESENCE_NULL},
}
_VALUELESS = {"empty", "not_empty", "exists", "not_exists"}
#: Words a model uses for an operator that the alias table does not know.
_WORDS = {
    "is": "eq", "=": "eq", "equals_to": "eq", "is_not": "ne", "isnt": "ne", "has": "contains",
    "includes": "contains", "include": "contains", "one_of": "in", "any_of": "in", "none_of": "not_in",
    "above": "gt", "over": "gt", "more_than": "gt", "below": "lt", "under": "lt", "less_than": "lt",
    "at_least": "gte", "at_most": "lte", "on_or_after": "gte", "on_or_before": "lte", "since": "gte",
    "until": "lte", "missing": "empty", "blank": "empty", "present": "not_empty", "set": "not_empty",
}
DATE_FORMAT = "%Y-%m-%d %H:%M:%S"


def _new_id() -> str:
    return str(uuid.uuid4())


# ── Field and operator resolution ─────────────────────────────────────────


def resolve_field(raw: Any, resource) -> Field | None:
    name = str(raw or "").strip()
    if not name:
        return None
    fields = resource.fields
    if name in fields.by_name:
        return fields.by_name[name]
    lowered = name.lower().replace(" ", "_")
    for spec in fields.fields:
        if spec.name.lower() == lowered or spec.title.lower() == name.lower():
            return spec
    candidates = {spec.name: spec for spec in fields.fields}
    candidates.update({spec.title.lower(): spec for spec in fields.fields})
    close = difflib.get_close_matches(lowered, list(candidates), n=1, cutoff=0.75) or difflib.get_close_matches(
        name.lower(), list(candidates), n=1, cutoff=0.75
    )
    return candidates[close[0]] if close else None


def resolve_operator(raw: Any, spec: Field, value_count: int) -> str | None:
    word = str(raw or "eq").strip().lower().replace(" ", "_")
    try:
        op = canonical_operator(_WORDS.get(word, word))
    except ValidationError:
        return None
    allowed = OPERATORS_BY_KIND.get(spec.kind, frozenset())
    if op in allowed:
        return op
    # Repairs: the nearest operator the kind does allow.
    repairs = {
        "contains": "in" if value_count > 1 else "eq",
        "starts": "eq", "ends": "eq", "not": "ne",
        "before": "lt", "after": "gt",
        "in": "eq", "not_in": "ne",
    }
    fixed = repairs.get(op)
    if fixed == "in" and "in" not in allowed:
        fixed = "eq"
    return fixed if fixed in allowed else None


# ── Value coercion ────────────────────────────────────────────────────────


def _flat(value: Any) -> list[Any]:
    if value is None:
        return []
    if isinstance(value, (list, tuple)):
        out: list[Any] = []
        for item in value:
            out.extend(_flat(item) if isinstance(item, (list, tuple)) else [item])
        return [v for v in out if v is not None and v != ""]
    if isinstance(value, str) and "," in value and not re.match(r"^\d{4}-\d\d-\d\d", value):
        return [part.strip() for part in value.split(",") if part.strip()]
    return [value]


def _choice(value: Any, choices: tuple[str, ...]) -> str | None:
    if not choices:
        return str(value)
    wanted = re.sub(r"[\s\-]+", "_", str(value).strip()).upper()
    for choice in choices:
        if choice.upper() == wanted:
            return choice
    close = difflib.get_close_matches(wanted, [c.upper() for c in choices], n=1, cutoff=0.8)
    if close:
        return next(c for c in choices if c.upper() == close[0])
    return None


def _boolean(value: Any) -> bool | None:
    if isinstance(value, bool):
        return value
    text = str(value).strip().lower()
    if text in ("true", "yes", "1", "y", "on"):
        return True
    if text in ("false", "no", "0", "n", "off"):
        return False
    return None


def _number(value: Any) -> int | float | None:
    try:
        number = float(str(value).replace(",", "").strip())
    except (TypeError, ValueError):
        return None
    return int(number) if number.is_integer() else number


_RELATIVE = re.compile(r"^(?:@?today|@?now)?\s*([+-])\s*(\d+)\s*([dwmy])$")


def _moment(value: Any, *, today: datetime) -> str | None:
    text = str(value).strip().lower()
    base = today.replace(hour=0, minute=0, second=0, microsecond=0)
    if text in ("today", "@today"):
        return base.strftime(DATE_FORMAT)
    if text in ("now", "@now"):
        return today.strftime(DATE_FORMAT)
    if text in ("tomorrow", "@tomorrow"):
        return (base + timedelta(days=1)).strftime(DATE_FORMAT)
    if text in ("yesterday", "@yesterday"):
        return (base - timedelta(days=1)).strftime(DATE_FORMAT)
    match = _RELATIVE.match(text)
    if match:
        sign, amount, unit = match.groups()
        days = int(amount) * {"d": 1, "w": 7, "m": 30, "y": 365}[unit]
        return (base + timedelta(days=days if sign == "+" else -days)).strftime(DATE_FORMAT)
    raw = str(value).strip().replace("T", " ").replace("Z", "")
    for fmt in (DATE_FORMAT, "%Y-%m-%d %H:%M", "%Y-%m-%d"):
        try:
            return datetime.strptime(raw[: len(datetime(2000, 1, 1).strftime(fmt))], fmt).strftime(DATE_FORMAT)
        except ValueError:
            continue
    return None


def _references(session, spec: Field, values: list[Any], *, principal) -> list[str]:
    """Ids for the people or records a question *named*."""
    target = explorer.references_of(spec)
    ids: list[str] = []
    for value in values:
        text = str(value).strip()
        if text.lower() in ("@me", "me", "myself", "mine", "i"):
            ids.append(str(principal.user_id))
            continue
        try:
            ids.append(str(uuid.UUID(text)))
            continue
        except ValueError:
            pass
        if not target or session is None:
            continue
        if target == "user":
            from src.models.identity import User

            rows = session.scalars(
                select(User.id).where(or_(User.full_name.ilike(f"%{text}%"), User.username.ilike(text),
                                          User.email.ilike(text))).limit(5)
            ).all()
        else:
            ref = explorer.resources().get(target)
            if ref is None or not principal.can(ref.permission):
                continue
            column = getattr(ref.model, ref.title_field, None)
            if column is None:
                continue
            exact = session.scalars(select(ref.model.id).where(column.ilike(text)).limit(5)).all()
            if exact:
                ids.extend(str(r) for r in exact)
                continue
            clauses = [column.ilike(f"%{text}%")]
            for extra in ("code", "reference", "name"):
                col = getattr(ref.model, extra, None)
                if col is not None and extra != ref.title_field:
                    clauses.append(col.ilike(text))
            rows = session.scalars(select(ref.model.id).where(or_(*clauses)).limit(5)).all()
        ids.extend(str(r) for r in rows)
    return list(dict.fromkeys(ids))


def coerce_values(session, spec: Field, op: str, raw: Any, *, principal, today: datetime) -> list[Any] | None:
    """The value list for a rule, or None when nothing usable is left."""
    if op in _VALUELESS:
        return []
    values = _flat(raw)
    if spec.kind == "enum":
        values = [c for v in values if (c := _choice(v, spec.choices)) is not None]
    elif spec.kind == "bool":
        values = [b for v in values if (b := _boolean(v)) is not None]
    elif spec.kind == "number":
        values = [n for v in values if (n := _number(v)) is not None]
    elif spec.kind == "datetime":
        values = [m for v in values if (m := _moment(v, today=today)) is not None]
    elif spec.kind == "uuid":
        values = _references(session, spec, values, principal=principal)
    else:
        values = [str(v) for v in values]
    values = list(dict.fromkeys(values))
    if not values:
        return None
    if op == "between":
        return values[:2] if len(values) >= 2 else None
    if op in ("in", "not_in"):
        return [values]
    return [values[0]]


# ── The tree ──────────────────────────────────────────────────────────────


class _Walk:
    def __init__(self, resource, *, session, principal):
        self.resource = resource
        self.session = session
        self.principal = principal
        self.notes: list[str] = []
        self.rules = 0
        self.today = now().astimezone(UTC)

    def node(self, node: Any, depth: int) -> dict[str, Any] | None:
        if not isinstance(node, dict):
            return None
        if depth > MAX_DEPTH:
            self.notes.append("Dropped groups nested too deeply.")
            return None
        kind = str(node.get("type") or ("group" if ("children1" in node or "children" in node) else "rule")).lower()
        if kind in ("group", "rule_group"):
            return self.group(node, depth)
        return self.rule(node)

    def group(self, node: dict[str, Any], depth: int) -> dict[str, Any] | None:
        props = node.get("properties") or {}
        conjunction = str(props.get("conjunction") or node.get("conjunction") or "AND").upper()
        if conjunction not in ("AND", "OR"):
            conjunction = "OR" if conjunction in ("ANY", "|", "||") else "AND"
        raw = node.get("children1", node.get("children")) or []
        children = list(raw.values()) if isinstance(raw, dict) else list(raw) if isinstance(raw, list) else []
        kept: dict[str, Any] = {}
        for child in children:
            built = self.node(child, depth + 1)
            if built is not None:
                kept[built["id"]] = built
        if not kept and depth > 0:
            return None
        return {
            "id": _new_id(),
            "type": "group",
            "properties": {"conjunction": conjunction, "not": bool(props.get("not", node.get("not", False)))},
            "children1": kept,
        }

    def rule(self, node: dict[str, Any]) -> dict[str, Any] | None:
        props = node.get("properties") or node
        raw_field = props.get("field") or props.get("fieldName")
        spec = resolve_field(raw_field, self.resource)
        if spec is None or not spec.filterable:
            self.notes.append(f"Ignored “{raw_field}”: {self.resource.label.lower()} have no such field.")
            return None
        values = props.get("value")
        op = resolve_operator(props.get("operator"), spec, len(_flat(values)))
        if op is None:
            self.notes.append(f"Ignored a rule on {spec.title}: “{props.get('operator')}” cannot compare it.")
            return None
        coerced = coerce_values(self.session, spec, op, values, principal=self.principal, today=self.today)
        if coerced is None and op == "between":
            # One end of a range is still a bound.
            single = coerce_values(self.session, spec, "eq", values, principal=self.principal, today=self.today)
            if single:
                op, coerced = "gte", single
        if coerced is None:
            self.notes.append(f"Ignored a rule on {spec.title}: “{_flat(values)[:3]}” is not a value it can hold.")
            return None
        self.rules += 1
        if self.rules > MAX_RULES:
            raise ValidationError(f"a query may contain at most {MAX_RULES} rules")
        builder_type = BUILDER_TYPE.get(spec.kind, "text")
        operator = BUILDER_OPERATOR[builder_type].get(op)
        if operator is None:  # pragma: no cover - the maps cover every allowed operator
            return None
        return {
            "id": _new_id(),
            "type": "rule",
            "properties": {
                "field": spec.name,
                "operator": operator,
                "value": coerced,
                "valueSrc": ["value"] * len(coerced),
                "valueType": [builder_type] * len(coerced),
            },
        }


def normalise(tree: Any, resource, *, session, principal) -> tuple[dict[str, Any], list[str]]:
    """A tree the builder can render and the compiler accepts, and what was repaired."""
    walk = _Walk(resource, session=session, principal=principal)
    if isinstance(tree, dict) and str(tree.get("type") or "group").lower() not in ("group", "rule_group"):
        tree = {"type": "group", "properties": {"conjunction": "AND"}, "children1": [tree]}
    root = walk.node(tree if isinstance(tree, dict) else {"type": "group", "children1": []}, 0)
    root = root or {"id": _new_id(), "type": "group", "properties": {"conjunction": "AND", "not": False},
                    "children1": {}}
    compile_tree(root, resource.fields)  # the same compiler the search runs; raises if it could not
    return root, walk.notes


# ── Prompt ────────────────────────────────────────────────────────────────


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


# ── Without a model ───────────────────────────────────────────────────────


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


# ── The endpoint's work ───────────────────────────────────────────────────


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
