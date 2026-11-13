"""Walking a graph for one record: flow nodes, actions, approvals."""

from __future__ import annotations

from typing import Any

from src.services.automation.graph.flow import _flow
from src.services.automation.graph.kinds import FLOW
from src.services.automation.graph.shape import _ACTIVE, MAX_NODES, _by_id, _outgoing
from src.services.automation.graph.walk import Walk, _filter
from src.services.automation.workflows.matching import _reason
from src.services.automation.workflows.registry import ACTIONS


def _walk(session, walk: Walk, starts: list[tuple[str, list]]) -> None:
    """Breadth-first over the graph, carrying the set of records at each node."""
    by_id = _by_id(walk.graph)
    outgoing = _outgoing(walk.graph)
    queue: list[tuple[str, list]] = [item for item in starts if item[1]]
    steps = 0
    while queue:
        steps += 1
        if steps > MAX_NODES * 4:  # unreachable for a validated DAG; a backstop
            break
        node_id, matches = queue.pop(0)
        node = by_id.get(node_id)
        if node is None or not matches:
            continue
        walk.count(node_id, "in", len(matches))
        data = node.get("data") or {}
        exits: dict[str, list] = {}

        if node["type"] == "trigger":
            for match in matches:
                walk.visit(node_id, match, "started")
            exits["out"] = matches
        elif node["type"] in ("condition", "branch"):
            kept = _filter(session, walk.resource, data.get("tree"), matches)
            kept_ids = {match.id for match in kept}
            dropped = [match for match in matches if match.id not in kept_ids]
            for match in matches:
                passed = match.id in kept_ids
                if node["type"] == "branch":
                    walk.visit(node_id, match, "yes" if passed else "no")
                else:
                    walk.visit(node_id, match, "passed" if passed else "stopped")
            if node["type"] == "branch":
                exits["true"], exits["false"] = kept, dropped
                walk.count(node_id, "true", len(kept))
                walk.count(node_id, "false", len(dropped))
            else:
                exits["out"] = kept
                walk.count(node_id, "out", len(kept))
                walk.count(node_id, "stopped", len(dropped))
        else:
            kind = str(data.get("kind") or "").upper()
            if kind in FLOW:
                exits = _flow(session, walk, node, kind, data, matches)
            else:
                for match in matches:
                    ok, detail = _run_action(session, walk, kind, data, match)
                    walk.count(node_id, "ok" if ok else "failed")
                    walk.visit(node_id, match, "done" if ok else "failed", detail)
                    walk.records[match.id]["actions"].append(
                        {"kind": kind, "ok": ok, "detail": detail, "node_id": node_id}
                    )
                exits["out"] = matches

        for edge in outgoing.get(node_id, []):
            forward = exits.get(edge["port"]) or []
            if forward:
                walk.edges_taken[edge["id"]] = walk.edges_taken.get(edge["id"], 0) + len(forward)
                queue.append((edge["target"], forward))


def _run_action(session, walk: Walk, kind: str, data: dict[str, Any], match) -> tuple[bool, str]:
    if walk.dry_run:
        return True, f"would {ACTIONS[kind].label.lower()}" if kind in ACTIONS else "would run"
    action = ACTIONS.get(kind)
    if action is None:
        return False, "no such action"
    savepoint = session.begin_nested()
    token = _ACTIVE.set(True)
    try:
        detail = action.run(session, rule=walk.rule, match=match, config=data)
        savepoint.commit()
        return True, detail
    except Exception as error:  # noqa: BLE001 - recorded, never raised
        savepoint.rollback()
        return False, _reason(error)
    finally:
        _ACTIVE.reset(token)
