"""Normalising a model's tree into one the builder accepts."""

from __future__ import annotations

from datetime import UTC
from typing import Any

from src.core.clock import now
from src.core.errors import ValidationError
from src.core.rules import MAX_DEPTH, MAX_RULES, compile_tree
from src.services.ai.filters.values import _flat, coerce_values
from src.services.ai.filters.vocabulary import (
    BUILDER_OPERATOR,
    BUILDER_TYPE,
    _new_id,
    resolve_field,
    resolve_operator,
)


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
