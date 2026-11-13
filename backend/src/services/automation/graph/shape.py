"""A workflow graph's shape: node kinds, ports, normalisation and lookups."""

from __future__ import annotations

import contextvars
import re
from copy import deepcopy
from typing import Any

from src.core.errors import ValidationError

PERMISSION = "automations.manage"


#: A graph bigger than this is a program that wants to be code.
MAX_NODES = 60


MAX_EDGES = 120


#: Runs read for the per-node counts the canvas overlays.
STATS_RUNS = 50


_NODE_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


#: Set while an automation's own actions write records, so a workflow that
#: updates a task does not trigger itself (or another workflow) in a loop.
_ACTIVE: contextvars.ContextVar[bool] = contextvars.ContextVar("automation_active", default=False)


def normalize(raw: Any) -> dict[str, Any]:
    """The graph a client sent, checked for *shape* only.

    Shape errors (not an object, a node without an id, an edge to nowhere) are
    refused outright: nothing sensible can be stored. *Meaning* errors — a
    condition with no rules, an action that reaches nobody — are kept and
    reported per node by `problems`, because a draft is allowed to be
    unfinished and the canvas has to be able to say where.
    """
    if not isinstance(raw, dict):
        raise ValidationError("A workflow graph must be an object with nodes and edges.")
    nodes_in = raw.get("nodes")
    edges_in = raw.get("edges") or []
    if not isinstance(nodes_in, list) or not isinstance(edges_in, list):
        raise ValidationError("A workflow graph needs a list of nodes and a list of edges.")
    if len(nodes_in) > MAX_NODES:
        raise ValidationError(f"A workflow may have at most {MAX_NODES} nodes.")
    if len(edges_in) > MAX_EDGES:
        raise ValidationError(f"A workflow may have at most {MAX_EDGES} connections.")

    nodes: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in nodes_in:
        if not isinstance(item, dict):
            raise ValidationError("Each node must be an object.")
        node_id = str(item.get("id") or "")
        if not _NODE_ID.match(node_id):
            raise ValidationError("Each node needs an id of letters, digits, - or _.",
                                  details={"id": node_id})
        if node_id in seen:
            raise ValidationError("Two nodes share an id.", details={"id": node_id})
        seen.add(node_id)
        kind = str(item.get("type") or "")
        if kind not in ("trigger", "condition", "branch", "action"):
            raise ValidationError(f"{kind or '(none)'} is not a kind of node.",
                                  details={"id": node_id})
        position = item.get("position") if isinstance(item.get("position"), dict) else {}
        data = item.get("data") if isinstance(item.get("data"), dict) else {}
        nodes.append(
            {
                "id": node_id,
                "type": kind,
                "position": {"x": _number(position.get("x")), "y": _number(position.get("y"))},
                "data": deepcopy(data),
            }
        )

    edges: list[dict[str, Any]] = []
    edge_ids: set[str] = set()
    for index, item in enumerate(edges_in):
        if not isinstance(item, dict):
            raise ValidationError("Each connection must be an object.")
        source = str(item.get("source") or "")
        target = str(item.get("target") or "")
        if source not in seen or target not in seen:
            raise ValidationError("A connection joins a node that is not in the graph.",
                                  details={"source": source, "target": target})
        port = str(item.get("port") or item.get("sourceHandle") or "out")
        edge_id = str(item.get("id") or f"e{index}-{source}-{port}-{target}")[:120]
        if edge_id in edge_ids:
            edge_id = f"{edge_id}-{index}"
        edge_ids.add(edge_id)
        edges.append({"id": edge_id, "source": source, "port": port, "target": target})

    return {"nodes": nodes, "edges": edges}


def _number(value: Any) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return 0.0
    if number != number or abs(number) > 1e6:  # NaN, or off any sane canvas
        return 0.0
    return round(number, 1)


def trigger_of(graph: dict[str, Any] | None) -> dict[str, Any] | None:
    for node in (graph or {}).get("nodes") or []:
        if node.get("type") == "trigger":
            return node
    return None


def _by_id(graph: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {node["id"]: node for node in graph.get("nodes") or []}


def _outgoing(graph: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    out: dict[str, list[dict[str, Any]]] = {}
    for edge in graph.get("edges") or []:
        out.setdefault(edge["source"], []).append(edge)
    return out


def _resource(key: Any):
    from src.services.records.explorer import resources

    return resources().get(str(key or ""))


def assignable_field(resource) -> str | None:
    for name in ("assignee_id", "owner_id", "manager_id", "account_manager_id"):
        if name in resource.writable:
            return name
    return None
