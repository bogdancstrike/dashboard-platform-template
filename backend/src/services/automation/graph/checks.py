"""What is wrong with a graph before it may be published."""

from __future__ import annotations

from typing import Any

from sqlalchemy import select

from src.core.errors import ValidationError
from src.core.rules import compile_tree, rule_count
from src.services.automation.graph.cleaning import clean_action
from src.services.automation.graph.cron import _cron
from src.services.automation.graph.kinds import TRIGGERS, _ports_for
from src.services.automation.graph.shape import _by_id, _outgoing, _resource


def problems(session, graph: dict[str, Any]) -> list[dict[str, str]]:
    """Everything that stops this graph from being published, per node.

    `node_id` is "" for a problem with the whole graph. Returned rather than
    raised so the canvas can paint every one of them at once.
    """
    found: list[dict[str, str]] = []

    def say(node_id: str, message: str) -> None:
        found.append({"node_id": node_id, "message": message})

    nodes = graph.get("nodes") or []
    triggers = [node for node in nodes if node["type"] == "trigger"]
    if not triggers:
        say("", "A workflow starts with a trigger.")
        return found
    if len(triggers) > 1:
        for node in triggers[1:]:
            say(node["id"], "A workflow has exactly one trigger.")
    trigger = triggers[0]
    by_id = _by_id(graph)
    outgoing = _outgoing(graph)

    resource = _resource((trigger.get("data") or {}).get("resource_type"))
    _check_trigger(session, trigger, resource, outgoing, by_id, say)

    for edge in graph.get("edges") or []:
        source = by_id[edge["source"]]
        if edge["port"] not in _ports_for(source):
            say(source["id"], f"This node has no {edge['port']!r} output.")
        if edge["source"] == edge["target"]:
            say(source["id"], "A node cannot connect to itself.")
        if by_id[edge["target"]]["type"] == "trigger":
            say(source["id"], "Nothing can lead back into the trigger.")

    cycle = _cycle(graph)
    if cycle:
        say(cycle, "This connection makes a loop; a workflow must always move forward.")

    reachable = _reachable(graph, trigger["id"])
    for node in nodes:
        if node["id"] not in reachable:
            say(node["id"], "Not connected to the trigger, so it would never run.")

    actions = 0
    for node in nodes:
        data = node.get("data") or {}
        if node["type"] in ("condition", "branch"):
            _check_tree(data.get("tree"), resource, node["id"], say)
            if node["type"] == "branch" and not outgoing.get(node["id"]):
                say(node["id"], "Connect the Yes or No output — a branch that leads nowhere does nothing.")
        elif node["type"] == "action":
            if node["id"] in reachable:
                actions += 1
            try:
                clean_action(session, data, resource)
            except ValidationError as error:
                say(node["id"], error.message)
    if actions == 0:
        say("", "Add at least one action — a workflow that does nothing cannot be published.")
    return found


def _check_trigger(session, trigger, resource, outgoing, by_id, say) -> None:
    data = trigger.get("data") or {}
    event = str(data.get("event") or "").upper()
    if event not in TRIGGERS:
        say(trigger["id"], "Choose what starts this workflow.")
    if resource is None:
        say(trigger["id"], "Choose the dataset this workflow watches.")
        return
    if not outgoing.get(trigger["id"]):
        say(trigger["id"], "Connect the trigger to the first step.")
    if event == "FIELD_CHANGED" and str(data.get("field") or "") not in resource.fields.by_name:
        say(trigger["id"], "Choose which field's change starts this workflow.")
    if event == "SCHEDULE":
        try:
            _cron(str(data.get("schedule") or ""))
        except ValidationError as error:
            say(trigger["id"], error.message)
        first = [by_id[edge["target"]] for edge in outgoing.get(trigger["id"], [])]
        if len(first) != 1 or first[0]["type"] != "condition":
            say(trigger["id"], "A scheduled workflow starts with one condition: it says which records each run looks at.")
    if event == "FORM_SUBMITTED" and data.get("form"):
        from src.models.forms import IntakeForm

        if session.scalar(select(IntakeForm.id).where(IntakeForm.slug == str(data["form"]))) is None:
            say(trigger["id"], "That form does not exist.")


def _check_tree(tree: Any, resource, node_id: str, say) -> None:
    if not isinstance(tree, dict) or rule_count(tree) == 0:
        say(node_id, "Add at least one rule to this condition.")
        return
    if resource is None:
        return
    try:
        if compile_tree(tree, resource.fields) is None:
            say(node_id, "Finish the rules in this condition — each needs a value.")
    except ValidationError as error:
        say(node_id, error.message)


def _reachable(graph: dict[str, Any], start: str) -> set[str]:
    outgoing = _outgoing(graph)
    seen = {start}
    stack = [start]
    while stack:
        for edge in outgoing.get(stack.pop(), []):
            if edge["target"] not in seen:
                seen.add(edge["target"])
                stack.append(edge["target"])
    return seen


def _cycle(graph: dict[str, Any]) -> str | None:
    """The id of a node on a loop, or None. Iterative three-colour DFS."""
    outgoing = _outgoing(graph)
    state: dict[str, int] = {}
    for root in _by_id(graph):
        if state.get(root):
            continue
        stack: list[tuple[str, int]] = [(root, 0)]
        state[root] = 1
        while stack:
            node, index = stack[-1]
            edges = outgoing.get(node, [])
            if index < len(edges):
                stack[-1] = (node, index + 1)
                target = edges[index]["target"]
                if state.get(target) == 1:
                    return node
                if not state.get(target):
                    state[target] = 1
                    stack.append((target, 0))
            else:
                state[node] = 2
                stack.pop()
    return None
