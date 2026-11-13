"""Rules written in the form editor, as graphs and back (§49)."""

from __future__ import annotations

from copy import deepcopy
from typing import Any

from src.core.errors import ValidationError
from src.core.rules import describe_tree, rule_count
from src.models.platform import AlertRule
from src.services.automation.graph.cleaning import clean_action
from src.services.automation.graph.cron import _cron
from src.services.automation.graph.kinds import FLOW, TRIGGERS
from src.services.automation.graph.shape import _by_id, _outgoing, _resource, trigger_of
from src.services.automation.workflows.registry import ACTIONS

#: Vertical spacing of a converted rule, matching the canvas's auto-layout.
_ROW = 150


def from_legacy(rule: AlertRule) -> dict[str, Any]:
    """The graph a form-built rule has always meant: schedule → condition → actions."""
    nodes: list[dict[str, Any]] = [
        {
            "id": "trigger",
            "type": "trigger",
            "position": {"x": 0, "y": 0},
            "data": {"event": "SCHEDULE", "resource_type": rule.resource_type,
                     "schedule": rule.schedule or "*/15 * * * *"},
        },
        {
            "id": "condition",
            "type": "condition",
            "position": {"x": 0, "y": _ROW},
            "data": {"tree": rule.condition_tree},
        },
    ]
    edges = [{"id": "e-trigger-condition", "source": "trigger", "port": "out", "target": "condition"}]
    previous = "condition"
    for index, action in enumerate(a for a in (rule.actions or []) if isinstance(a, dict)):
        node_id = f"action{index + 1}"
        nodes.append({"id": node_id, "type": "action",
                      "position": {"x": 0, "y": _ROW * (index + 2)}, "data": dict(action)})
        edges.append({"id": f"e-{previous}-{node_id}", "source": previous, "port": "out", "target": node_id})
        previous = node_id
    return {"nodes": nodes, "edges": edges}


def linear(graph: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any] | None, list[dict[str, Any]]] | None:
    """(trigger, condition, actions) when the graph is one straight line, else None.

    The straight line is what the form editor can show and edit: one trigger,
    at most one condition straight after it, then actions one after another,
    none of them a delay or an approval.
    """
    by_id = _by_id(graph)
    outgoing = _outgoing(graph)
    trigger = trigger_of(graph)
    if trigger is None:
        return None
    incoming: dict[str, int] = {}
    for edge in graph.get("edges") or []:
        incoming[edge["target"]] = incoming.get(edge["target"], 0) + 1
    chain: list[dict[str, Any]] = []
    current = trigger
    seen = {trigger["id"]}
    while True:
        edges = outgoing.get(current["id"], [])
        if not edges:
            break
        if len(edges) != 1:
            return None
        current = by_id[edges[0]["target"]]
        if current["id"] in seen or incoming.get(current["id"], 0) != 1:
            return None
        seen.add(current["id"])
        chain.append(current)
    if len(seen) != len(by_id):
        return None
    condition = None
    if chain and chain[0]["type"] == "condition":
        condition = chain.pop(0)
    for node in chain:
        kind = str((node.get("data") or {}).get("kind") or "").upper()
        if node["type"] != "action" or kind in FLOW:
            return None
    return trigger, condition, chain


def apply_form_edit(graph: dict[str, Any] | None, rule: AlertRule) -> dict[str, Any]:
    """Rebuild a straight-line graph from the rule's (just edited) columns.

    Keeps the trigger as it was — the form editor never changed what starts a
    workflow — and reuses node ids and positions where a node is still there, so
    the canvas does not jump about after somebody edits in the form.
    """
    fresh = from_legacy(rule)
    if graph is None:
        return fresh
    parts = linear(graph)
    if parts is None:
        raise ValidationError(
            "This workflow branches, waits or asks for approval, so the form cannot show all of it. "
            "Edit it on the canvas.",
        )
    trigger, condition, actions = parts
    trigger = deepcopy(trigger)
    trigger["data"]["resource_type"] = rule.resource_type
    if str(trigger["data"].get("event")) == "SCHEDULE":
        trigger["data"]["schedule"] = rule.schedule
    nodes = [trigger]
    edges: list[dict[str, Any]] = []
    previous = trigger
    old = ([condition] if condition else []) + actions
    new = [node for node in fresh["nodes"] if node["type"] != "trigger"]
    if condition is None and not (rule.condition_tree and rule_count(rule.condition_tree)):
        new = [node for node in new if node["type"] != "condition"]
    for index, node in enumerate(new):
        if index < len(old) and old[index]["type"] == node["type"]:
            node = {**node, "id": old[index]["id"], "position": old[index]["position"]}
        nodes.append(node)
        edges.append({"id": f"e-{previous['id']}-{node['id']}", "source": previous["id"],
                      "port": "out", "target": node["id"]})
        previous = node
    return {"nodes": nodes, "edges": edges}


def derive_legacy(session, graph: dict[str, Any]) -> dict[str, Any]:
    """The `alert_rules` columns a published graph implies, for lists and filters."""

    trigger = trigger_of(graph) or {"data": {}}
    data = trigger.get("data") or {}
    resource = _resource(data.get("resource_type"))
    values: dict[str, Any] = {"resource_type": resource.key if resource else str(data.get("resource_type"))}
    if str(data.get("event")) == "SCHEDULE" and data.get("schedule"):
        values["schedule"] = _cron(str(data["schedule"]))
    first = next(
        (node for node in graph.get("nodes") or [] if node["type"] in ("condition", "branch")), None
    )
    tree = (first.get("data") or {}).get("tree") if first else None
    values["condition_tree"] = tree
    values["condition_text"] = (describe_tree(tree, resource.fields) or None) if (tree and resource) else None
    actions = []
    for node in graph.get("nodes") or []:
        if node["type"] == "action":
            kind = str((node.get("data") or {}).get("kind") or "").upper()
            if kind in ACTIONS:
                actions.append(clean_action(session, node["data"], resource))
    values["actions"] = actions
    return values


def describe_trigger(graph: dict[str, Any] | None) -> dict[str, Any] | None:
    """One line saying what starts a workflow, for the list."""
    trigger = trigger_of(graph)
    if trigger is None:
        return None
    data = trigger.get("data") or {}
    event = str(data.get("event") or "").upper()
    meta = TRIGGERS.get(event, {"label": event})
    text = meta["label"]
    if event == "FIELD_CHANGED" and data.get("field"):
        text = f"{data['field']} changes" + (f" to {data['to']}" if data.get("to") else "")
    elif event == "SCHEDULE":
        text = f"Schedule {data.get('schedule') or ''}".strip()
    elif event == "FORM_SUBMITTED" and data.get("form"):
        text = f"Form {data['form']} submitted"
    return {"event": event, "label": meta["label"], "text": text}
