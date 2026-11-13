"""A rule's graph: draft, publish, versions, restore and per-node stats."""

from __future__ import annotations

import secrets
from typing import Any

from sqlalchemy import select

from src.core import audit
from src.core.clock import iso, now
from src.core.errors import ValidationError
from src.core.pagination import parse_uuid
from src.core.repository import get_or_404
from src.models.automation_graphs import AutomationGraph, AutomationVersion
from src.models.platform import AlertRule, AlertRuleRun
from src.services.automation.graph.checks import problems
from src.services.automation.graph.legacy import derive_legacy, from_legacy
from src.services.automation.graph.shape import (
    PERMISSION,
    STATS_RUNS,
    _resource,
    normalize,
    trigger_of,
)
from src.services.automation.graph.walk import resource_for_principal
from src.services.automation.workflows.serializers import (
    _audit_state,
    _can_edit,
    _serialize,
)
from src.services.automation.workflows.validation import (
    _require_own as validation_require_own,
)


def ensure(session, rule: AlertRule) -> AutomationGraph:
    """The rule's graph row, created from its form-built columns when missing."""
    row = session.scalar(select(AutomationGraph).where(AutomationGraph.rule_id == rule.id))
    if row is None:
        graph = from_legacy(rule)
        row = AutomationGraph(rule_id=rule.id, draft=graph, published=graph, version=1,
                              published_at=rule.updated_at or now(), published_by_id=rule.owner_id)
        session.add(row)
        session.add(AutomationVersion(rule_id=rule.id, version=1, graph=graph,
                                      note="Converted from the form editor", published_by_id=rule.owner_id))
        session.flush()
    return row


def _rule(session, rule_id: Any) -> AlertRule:
    rule = get_or_404(
        session,
        AlertRule,
        parse_uuid(rule_id, field="rule_id"),
        "That automation does not exist.",
        live=True,
    )
    return rule


def _require_own(rule: AlertRule, principal) -> None:

    validation_require_own(rule, principal)


def detail(session, rule_id: Any, *, principal) -> dict[str, Any]:
    """Everything the canvas opens with."""

    principal.require(PERMISSION)
    rule = _rule(session, rule_id)
    row = ensure(session, rule)
    draft = row.draft or row.published
    versions = session.scalars(
        select(AutomationVersion).where(AutomationVersion.rule_id == rule.id)
        .order_by(AutomationVersion.version.desc()).limit(30)
    ).all()
    return {
        "rule": _serialize(rule, principal, graph=row),
        "draft": draft,
        "published": row.published,
        "version": row.version,
        "published_at": iso(row.published_at),
        "published_by": row.published_by.full_name if row.published_by else None,
        "draft_updated_at": iso(row.draft_updated_at),
        "dirty": (row.draft or None) != (row.published or None) and row.draft is not None,
        "problems": problems(session, normalize(draft)) if draft else [],
        "versions": [
            {"version": item.version, "published_at": iso(item.created_at), "note": item.note,
             "by": item.published_by.full_name if item.published_by else None,
             "nodes": len((item.graph or {}).get("nodes") or [])}
            for item in versions
        ],
        "stats": node_stats(session, rule.id),
        "webhook_path": f"/public/automations/hooks/{row.webhook_token}" if row.webhook_token else None,
        "can_edit": _can_edit(rule, principal),
    }


def save_draft(session, rule_id: Any, payload: dict[str, Any] | None, *, principal) -> dict[str, Any]:
    """Keep what the canvas holds. `{"graph": null}` throws the draft away."""
    principal.require(PERMISSION)
    rule = _rule(session, rule_id)
    _require_own(rule, principal)
    row = ensure(session, rule)
    body = payload if isinstance(payload, dict) else {}
    if "graph" not in body:
        raise ValidationError("Send the graph to keep, or null to discard the draft.")
    row.draft = normalize(body["graph"]) if body["graph"] is not None else row.published
    row.draft_updated_at = now()
    row.draft_updated_by_id = getattr(principal, "user_id", None)
    session.flush()
    return detail(session, rule.id, principal=principal)


def publish(session, rule_id: Any, payload: dict[str, Any] | None, *, principal) -> dict[str, Any]:
    """Make the draft the version that runs — refused, per node, if it cannot run."""

    principal.require(PERMISSION)
    rule = _rule(session, rule_id)
    _require_own(rule, principal)
    row = ensure(session, rule)
    graph = normalize(row.draft or row.published)
    found = problems(session, graph)
    if found:
        raise ValidationError(
            f"{len(found)} thing{'s' if len(found) != 1 else ''} to fix before this can be published.",
            details={"problems": found},
        )
    resource = _resource(trigger_of(graph)["data"].get("resource_type"))
    resource_for_principal(resource, principal)
    before = _audit_state(rule)
    _install(session, rule, row, graph, principal=principal,
             note=str((payload or {}).get("note") or "").strip()[:500] or None)
    audit.record(
        session, action="automation.publish", resource_type="alert_rule", resource_id=rule.id,
        resource_label=rule.name, principal=principal, before=before,
        after={**_audit_state(rule), "version": row.version},
        message=f"published version {row.version}",
    )
    return detail(session, rule.id, principal=principal)


def _install(session, rule: AlertRule, row: AutomationGraph, graph: dict[str, Any], *, principal,
             note: str | None) -> None:
    """Make `graph` the published version, and project it onto the rule."""
    for name, value in derive_legacy(session, graph).items():
        setattr(rule, name, value)
    trigger = trigger_of(graph)
    if trigger and trigger["data"].get("event") == "WEBHOOK" and not row.webhook_token:
        row.webhook_token = secrets.token_urlsafe(24)
    row.draft = graph
    row.published = graph
    row.version = int(row.version or 0) + 1
    row.published_at = now()
    row.published_by_id = getattr(principal, "user_id", None)
    session.add(AutomationVersion(rule_id=rule.id, version=row.version, graph=graph, note=note,
                                  published_by_id=row.published_by_id))
    session.flush()


def node_stats(session, rule_id: Any) -> dict[str, Any]:
    """Per-node counts summed over recent real runs — the canvas's history overlay."""
    rows = session.scalars(
        select(AlertRuleRun).where(AlertRuleRun.rule_id == rule_id, AlertRuleRun.dry_run.is_(False))
        .order_by(AlertRuleRun.started_at.desc()).limit(STATS_RUNS)
    ).all()
    nodes: dict[str, dict[str, int]] = {}
    edges: dict[str, int] = {}
    for run in rows:
        detail_ = run.detail if isinstance(run.detail, dict) else {}
        for node_id, counts in (detail_.get("nodes") or {}).items():
            bucket = nodes.setdefault(node_id, {})
            for key, value in (counts or {}).items():
                bucket[key] = bucket.get(key, 0) + int(value or 0)
        for edge_id, value in (detail_.get("edges") or {}).items():
            edges[edge_id] = edges.get(edge_id, 0) + int(value or 0)
    return {"runs": len(rows), "nodes": nodes, "edges": edges}
