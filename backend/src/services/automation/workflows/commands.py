"""Writing rules: create, update, remove, run now."""

from __future__ import annotations

from typing import Any

from src.core import audit
from src.core.clock import now
from src.core.errors import ValidationError
from src.models.platform import AlertRule
from src.services.automation.graph.editing import (
    after_form_edit,
    check_form_edit,
    create_with_graph,
)
from src.services.automation.graph.runs import evaluate as runs_evaluate
from src.services.automation.graph.shape import normalize, trigger_of
from src.services.automation.graph.storage import ensure
from src.services.automation.workflows.actions import PERMISSION
from src.services.automation.workflows.serializers import _audit_state, _serialize
from src.services.automation.workflows.validation import _require_own, _rule, _validated


def evaluate(session, rule: AlertRule, *, principal, dry_run: bool) -> dict[str, Any]:
    """Run one rule: select what matches, act on what is not cooling down.

    The graph engine (`automation_graph.evaluate`) is the one evaluator: a
    form-built rule is a straight-line graph, so "run now" on it walks exactly
    the code a canvas-built workflow walks. Returns the run as the page reads
    it; the run row is written whichever way the evaluation went.
    """

    return runs_evaluate(session, rule, principal=principal, dry_run=dry_run)


def create(session, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    principal.require(PERMISSION)

    data = payload if isinstance(payload, dict) else {}
    if data.get("graph") is not None:
        # Written on the canvas: the graph is the definition, and the columns
        # the list reads are projected from it when it is installed.
        graph = normalize(data["graph"])
        trigger = trigger_of(graph) or {"data": {}}
        seed = {
            "name": data.get("name"),
            "description": data.get("description"),
            "resource_type": trigger["data"].get("resource_type") or "task",
            "condition_tree": None,
            "actions": [{"kind": "TASK"}],
        }
        # Paused unless asked otherwise, like a rule from the wizard: a starter
        # graph is installed straight away, and it must not start notifying
        # people about every new record before its author has finished it.
        seed["enabled"] = False
        for key in ("severity", "enabled", "cooldown_minutes"):
            if key in data:
                seed[key] = data[key]
        values = _validated(session, seed, principal=principal, partial=False)
        rule = AlertRule(owner_id=getattr(principal, "user_id", None), **values)
        if "cooldown_minutes" not in data:
            rule.cooldown_minutes = 0
        session.add(rule)
        session.flush()
        graph_row = create_with_graph(session, rule, graph, principal=principal)
    else:
        values = _validated(session, data, principal=principal, partial=False)
        rule = AlertRule(owner_id=getattr(principal, "user_id", None), **values)
        session.add(rule)
        session.flush()
        graph_row = ensure(session, rule)
    audit.record(
        session,
        action="automation.create",
        resource_type="alert_rule",
        resource_id=rule.id,
        resource_label=rule.name,
        principal=principal,
        after=_audit_state(rule),
    )
    return _serialize(rule, principal, graph=graph_row)


def update(session, rule_id: Any, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    principal.require(PERMISSION)
    rule = _rule(session, rule_id)
    _require_own(rule, principal)
    before = _audit_state(rule)

    values = _validated(session, payload, principal=principal, partial=True)
    structural = {"resource_type", "condition_tree", "actions", "schedule"} & set(values)
    if structural:
        # The form editor changed what the workflow *is*: refused for a graph
        # it cannot represent, carried into a new version otherwise — both
        # editors edit one stored definition.
        check_form_edit(session, rule)
    for name, value in values.items():
        setattr(rule, name, value)
    session.flush()
    if structural:
        after_form_edit(session, rule, principal=principal)
    audit.record(
        session,
        action="automation.update",
        resource_type="alert_rule",
        resource_id=rule.id,
        resource_label=rule.name,
        principal=principal,
        before=before,
        after=_audit_state(rule),
    )
    return _serialize(rule, principal, graph=ensure(session, rule))


def remove(session, rule_id: Any, *, principal) -> dict[str, Any]:
    principal.require(PERMISSION)
    rule = _rule(session, rule_id)
    _require_own(rule, principal)
    rule.deleted_at = now()
    rule.enabled = False
    session.flush()
    audit.record(
        session,
        action="automation.delete",
        resource_type="alert_rule",
        resource_id=rule.id,
        resource_label=rule.name,
        principal=principal,
        before=_audit_state(rule),
    )
    return {"deleted": True, "id": str(rule.id)}


def run_now(session, rule_id: Any, payload: dict[str, Any] | None, *, principal) -> dict[str, Any]:
    """Evaluate a rule on demand — as a dry run, or for real.

    A disabled rule may still be dry-run: reading what it *would* do is how
    somebody decides whether to enable it, and refusing that is refusing the
    only safe way to find out. Firing a disabled rule is refused, because
    "paused" has to mean something.
    """
    principal.require(PERMISSION)
    rule = _rule(session, rule_id)
    dry_run = bool((payload or {}).get("dry_run", True))
    if not dry_run:
        _require_own(rule, principal)
        if not rule.enabled:
            raise ValidationError(
                "That automation is paused. Dry-run it, or enable it first.",
                details={"rule_id": str(rule.id)},
            )
    answer = evaluate(session, rule, principal=principal, dry_run=dry_run)
    if not dry_run:
        audit.record(
            session,
            action="automation.run",
            resource_type="alert_rule",
            resource_id=rule.id,
            resource_label=rule.name,
            principal=principal,
            metadata={"matched": answer["matched"], "fired": answer["fired"]},
            message=f"{answer['fired']} of {answer['matched']} matches acted on",
            # Audited, but not in the human feed (§35). An automation firing is
            # the platform doing its job, not a person doing something — and a
            # feed of "3 of 11 matches acted on" every quarter of an hour
            # drowns everything a colleague actually did. The run history on
            # the rule is where this belongs, and it is already there.
            activity=False,
        )
    return answer
