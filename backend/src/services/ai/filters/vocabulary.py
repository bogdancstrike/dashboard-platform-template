"""Builder operators and types, and resolving a field or an operator."""

from __future__ import annotations

import difflib
import uuid
from typing import Any

from src.core.errors import ValidationError
from src.core.query import OPERATORS_BY_KIND, Field, canonical_operator

FEATURE = "filters"


MAX_QUESTION = 600


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
