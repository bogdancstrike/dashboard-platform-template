"""Parked walks: waiting for a delay or an approval, and resuming."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import select

from src.core.clock import iso, now
from src.models.automation_graphs import AutomationVersion, AutomationWait
from src.models.platform import AlertRule, AlertRuleRun
from src.services.automation.graph.engine import _walk
from src.services.automation.graph.kinds import APPROVAL_KIND
from src.services.automation.graph.shape import _ACTIVE, _outgoing, _resource
from src.services.automation.graph.storage import ensure
from src.services.automation.graph.walk import Walk, _matches_for
from src.services.automation.workflows.matching import _tally
from src.services.automation.workflows.serializers import serialize_run
from src.services.decisions import approvals


def resume(session, wait: AutomationWait, port: str) -> dict[str, Any] | None:
    """Carry a parked record on from its node, down `port`, in its own version."""
    wait.status = "RESUMED"
    wait.outcome = port
    wait.resumed_at = now()
    rule = session.get(AlertRule, wait.rule_id)
    if rule is None or rule.deleted_at is not None:
        wait.status = "CANCELLED"
        session.flush()
        return None
    version = session.scalar(select(AutomationVersion).where(
        AutomationVersion.rule_id == rule.id, AutomationVersion.version == wait.version))
    graph = (version.graph if version else None) or ensure(session, rule).published
    resource = _resource(wait.resource_type)
    record = session.get(resource.model, UUID(wait.record_id)) if resource else None
    if record is None or getattr(record, "deleted_at", None) is not None:
        wait.status = "CANCELLED"
        session.flush()
        return None

    run = AlertRuleRun(rule_id=rule.id, dry_run=False, started_at=now())
    session.add(run)
    session.flush()
    walk = Walk(rule=rule, graph=graph, resource=resource, dry_run=False, version=wait.version, run=run)
    match = _matches_for(resource, [record])[0]
    starts = [(edge["target"], [match]) for edge in _outgoing(graph).get(wait.node_id, [])
              if edge["port"] == port]
    for edge in _outgoing(graph).get(wait.node_id, []):
        if edge["port"] == port:
            walk.edges_taken[edge["id"]] = walk.edges_taken.get(edge["id"], 0) + 1
    walk.count(wait.node_id, port if port != "out" else "resumed")
    token = _ACTIVE.set(True)
    try:
        _walk(session, walk, starts)
    finally:
        _ACTIVE.reset(token)
    entry = walk.records.get(match.id) or {"actions": [], "nodes": []}
    run.finished_at = now()
    run.matched = 1
    run.fired = 1 if entry["actions"] else 0
    run.detail = {
        "sample": [{"record": match.label, "record_id": match.id, "path": match.path,
                    "state": "FIRED" if entry["actions"] else "SKIPPED",
                    "actions": entry["actions"], "nodes": entry["nodes"]}],
        "by_action": _tally([{"actions": entry["actions"]}]),
        "nodes": walk.counts, "edges": walk.edges_taken, "parked": walk.parked,
        "version": wait.version,
        "trigger": {"event": "RESUME", "record": match.label, "port": port},
    }
    if entry["actions"]:
        rule.last_triggered_at = run.finished_at
        rule.trigger_count = int(rule.trigger_count or 0) + 1
    session.flush()
    return serialize_run(run)


def _resume_on_decision(session, row, *, approved: bool, principal=None, comment: str = "",
                        **_: Any) -> None:
    """Approvals know "an automation asked" — deciding one resumes the workflow."""
    wait = session.scalar(select(AutomationWait).where(
        AutomationWait.approval_id == str(row.id), AutomationWait.status == "PENDING"))
    if wait is not None:
        resume(session, wait, "approved" if approved else "rejected")


approvals.register(approvals.Provider(
    kind=APPROVAL_KIND, label="Workflow approval", icon="flow",
    decide_permission="approvals.decide", sla_hours=24, apply=_resume_on_decision,
    reject_needs_comment=False,
))


def pending_waits(session, rule_id: Any) -> list[dict[str, Any]]:
    rows = session.scalars(
        select(AutomationWait).where(AutomationWait.rule_id == rule_id, AutomationWait.status == "PENDING")
        .order_by(AutomationWait.created_at.desc()).limit(25)
    ).all()
    return [{"id": str(row.id), "node_id": row.node_id, "kind": row.kind, "record": row.record_label,
             "record_id": row.record_id, "due_at": iso(row.due_at), "approval_id": row.approval_id}
            for row in rows]
