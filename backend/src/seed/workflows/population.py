"""Seed data for workflows: populate."""

from __future__ import annotations

import random
from datetime import timedelta
from typing import Any

from sqlalchemy import select

from src.core.clock import now
from src.seed.workflows.workflows import WORKFLOWS
from src.services.automation.graph.checks import problems
from src.services.automation.graph.editing import create_with_graph
from src.services.automation.graph.shape import normalize
from src.services.automation.graph.storage import ensure


def populate(session) -> dict[str, int]:
    """Graphs for every rule, the demo workflows, and their run history."""
    from src.core.auth import Principal
    from src.models.automation_graphs import AutomationGraph
    from src.models.identity import User
    from src.models.platform import AlertRule

    converted = 0
    for rule in session.scalars(select(AlertRule).where(AlertRule.deleted_at.is_(None))).all():
        if session.scalar(select(AutomationGraph.id).where(AutomationGraph.rule_id == rule.id)) is None:
            ensure(session, rule)
            converted += 1

    owner = session.scalar(select(User).where(User.username == "admin")) or session.scalar(select(User).limit(1))
    if owner is None:
        return {"converted": converted, "workflows": 0, "runs": 0}
    principal = Principal(user_id=owner.id, subject="", email=owner.email, username=owner.username,
                          full_name=owner.full_name, role_code="ADMINISTRATOR", permissions=frozenset())
    created = runs = 0
    rng = random.Random(4927)
    for spec in WORKFLOWS:
        if session.scalar(select(AlertRule.id).where(AlertRule.name == spec["name"],
                                                     AlertRule.deleted_at.is_(None))):
            continue
        graph = normalize(spec["graph"])
        if problems(session, graph):
            continue  # a dataset this deployment does not have
        rule = AlertRule(name=spec["name"], description=spec["description"], severity=spec["severity"],
                         resource_type=graph["nodes"][0]["data"]["resource_type"], enabled=True,
                         owner_id=owner.id, cooldown_minutes=0, actions=[],
                         created_at=now() - timedelta(days=21))
        session.add(rule)
        session.flush()
        row = create_with_graph(session, rule, graph, principal=principal)
        runs += _history(session, rule, graph, row.version, rng)
        created += 1
    session.flush()
    return {"converted": converted, "workflows": created, "runs": runs}


def _history(session, rule, graph: dict[str, Any], version: int, rng: random.Random) -> int:
    """A fortnight of plausible runs: how many records reached each node."""
    from src.models.platform import AlertRuleRun
    from src.services.automation.graph import _outgoing, trigger_of

    outgoing = _outgoing(graph)
    nodes = {node["id"]: node for node in graph["nodes"]}
    start = trigger_of(graph)["id"]
    made = 0
    total_fired = 0
    last = None
    for day in range(14, 0, -1):
        for _ in range(rng.randint(1, 4)):
            moment = now() - timedelta(days=day, minutes=rng.randint(0, 600))
            counts: dict[str, dict[str, int]] = {}
            edges: dict[str, int] = {}
            queue = [(start, rng.randint(1, 6))]
            fired = 0
            while queue:
                node_id, amount = queue.pop(0)
                if amount <= 0:
                    continue
                node = nodes[node_id]
                bucket = counts.setdefault(node_id, {})
                bucket["in"] = bucket.get("in", 0) + amount
                exits: dict[str, int] = {}
                if node["type"] == "branch":
                    yes = rng.randint(0, amount)
                    exits = {"true": yes, "false": amount - yes}
                    bucket.update({k: bucket.get(k, 0) + v for k, v in exits.items() if v})
                elif node["type"] == "condition":
                    kept = rng.randint(0, amount)
                    exits = {"out": kept}
                    bucket["out"] = bucket.get("out", 0) + kept
                elif node["type"] == "action" and node["data"].get("kind") == "APPROVAL":
                    yes = rng.randint(0, amount)
                    exits = {"approved": yes, "rejected": amount - yes}
                    bucket["ok"] = bucket.get("ok", 0) + amount
                elif node["type"] == "action":
                    failed = 1 if rng.random() < 0.06 else 0
                    bucket["ok"] = bucket.get("ok", 0) + amount - failed
                    if failed:
                        bucket["failed"] = failed
                    fired = max(fired, amount)
                    exits = {"out": amount}
                else:
                    exits = {"out": amount}
                for edge in outgoing.get(node_id, []):
                    forward = exits.get(edge["port"], 0)
                    if forward:
                        edges[edge["id"]] = edges.get(edge["id"], 0) + forward
                        queue.append((edge["target"], forward))
            matched = counts[start]["in"]
            session.add(AlertRuleRun(
                rule_id=rule.id, dry_run=False, started_at=moment,
                finished_at=moment + timedelta(milliseconds=rng.randint(40, 900)),
                matched=matched, fired=fired, created_at=moment,
                detail={"sample": [], "by_action": {}, "nodes": counts, "edges": edges, "parked": 0,
                        "version": version, "trigger": {"event": trigger_of(graph)["data"]["event"]}},
            ))
            total_fired += fired
            last = moment
            made += 1
    rule.trigger_count = total_fired
    rule.last_triggered_at = last
    return made
