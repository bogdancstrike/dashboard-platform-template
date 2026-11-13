"""A rule and a run as the API returns them."""

from __future__ import annotations

from typing import Any

from src.core.clock import iso
from src.core.rules import rule_count
from src.models.platform import AlertRule, AlertRuleRun
from src.services.automation.graph.legacy import describe_trigger, linear
from src.services.automation.workflows.registry import ACTIONS
from src.services.records.explorer import resources


def _serialize(rule: AlertRule, principal, graph=None) -> dict[str, Any]:

    owner = rule.owner
    resource = resources().get(rule.resource_type)
    published = graph.published if graph is not None else None
    return {
        # What starts it, and which version of its graph runs — so the list can
        # say "Record created" rather than a cron line nobody set.
        "trigger": describe_trigger(published),
        "version": int(graph.version or 0) if graph is not None else 0,
        "has_draft": bool(graph is not None and graph.draft and graph.draft != graph.published),
        "linear": bool(published is None or linear(published) is not None),
        "id": str(rule.id),
        "name": rule.name,
        "description": rule.description,
        "resource_type": rule.resource_type,
        "resource_label": resource.label if resource else rule.resource_type,
        "resource_path": resource.path if resource else "",
        # Whether the dataset it names still exists. A rule that outlived its
        # dataset can never fire, and the page has to say *that* rather than
        # reporting the consequences — an empty action list and a condition
        # nothing can compile are symptoms, and shown as faults they send
        # somebody looking for a bug in a rule that is simply obsolete.
        "resource_exists": resource is not None,
        "enabled": bool(rule.enabled),
        "severity": rule.severity,
        "condition_tree": rule.condition_tree,
        "condition_text": rule.condition_text,
        "condition_count": rule_count(rule.condition_tree),
        "actions": rule.actions or [],
        "action_summary": [
            ACTIONS[str(item.get("kind"))].label
            for item in (rule.actions or [])
            if isinstance(item, dict) and str(item.get("kind")) in ACTIONS
        ],
        "schedule": rule.schedule,
        "cooldown_minutes": int(rule.cooldown_minutes or 0),
        "owner": {
            "id": str(rule.owner_id) if rule.owner_id else None,
            "name": owner.full_name if owner else None,
        },
        "last_triggered_at": iso(rule.last_triggered_at),
        "trigger_count": int(rule.trigger_count or 0),
        "last_match_count": int(rule.last_match_count or 0),
        "created_at": iso(rule.created_at),
        "updated_at": iso(rule.updated_at),
        # Sent rather than inferred in the browser, because the reason a
        # control is absent is a fact the server holds (§76).
        "can_edit": _can_edit(rule, principal),
    }


def _can_edit(rule: AlertRule, principal) -> bool:
    if not rule.owner_id:
        return True
    return rule.owner_id == getattr(principal, "user_id", None) or principal.can("admin.access")


def serialize_run(run: AlertRuleRun) -> dict[str, Any]:
    detail = run.detail if isinstance(run.detail, dict) else {}
    return {
        "id": str(run.id),
        "rule_id": str(run.rule_id),
        "dry_run": bool(run.dry_run),
        "started_at": iso(run.started_at),
        "finished_at": iso(run.finished_at),
        "matched": int(run.matched or 0),
        "fired": int(run.fired or 0),
        "suppressed": int(run.suppressed or 0),
        "deferred": int(run.deferred or 0),
        "error": run.error,
        "capped": bool(detail.get("capped")),
        "sample": detail.get("sample") or [],
        "by_action": detail.get("by_action") or {},
        "triggered_by": run.triggered_by.full_name if run.triggered_by else None,
    }


def _audit_state(rule: AlertRule) -> dict[str, Any]:
    """What an audit entry keeps of a rule: the parts somebody argues about."""
    return {
        "name": rule.name,
        "resource_type": rule.resource_type,
        "enabled": bool(rule.enabled),
        "severity": rule.severity,
        "condition_text": rule.condition_text,
        "actions": rule.actions or [],
        "schedule": rule.schedule,
        "cooldown_minutes": int(rule.cooldown_minutes or 0),
    }
