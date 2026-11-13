"""Running a graph over its matches, a dry-run trace, and sample records."""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from src.core.clock import iso, now
from src.core.errors import ValidationError
from src.models.automation_graphs import AutomationGraph
from src.models.platform import AlertRule, AlertRuleRun
from src.services.automation.graph.engine import _walk
from src.services.automation.graph.legacy import from_legacy
from src.services.automation.graph.shape import _by_id, _outgoing, _resource, trigger_of
from src.services.automation.graph.storage import ensure
from src.services.automation.graph.walk import Walk, _matches_for
from src.services.automation.workflows.matching import (
    MAX_FIRES,
    SAMPLE_SIZE,
    _cooldown_ledger,
    _matches,
    _remember,
    _tally,
)
from src.services.automation.workflows.serializers import serialize_run


def evaluate(
    session,
    rule: AlertRule,
    *,
    principal,
    dry_run: bool,
    records: list[Any] | None = None,
    event: dict[str, Any] | None = None,
    graph_row: AutomationGraph | None = None,
) -> dict[str, Any]:
    """Run the published graph — over its population, or over given records.

    Without `records` this is a scheduled or "run now" evaluation: the records
    are the ones the condition straight after the trigger selects, through the
    same cooldown and fire budget the form-built rules always had. With
    `records` it is an event — a create, an edit, a webhook — and the records
    walk the whole graph, every condition included.
    """

    graph_row = graph_row or ensure(session, rule)
    graph = graph_row.published or from_legacy(rule)
    run = AlertRuleRun(
        rule_id=rule.id,
        dry_run=dry_run,
        triggered_by_id=getattr(principal, "user_id", None),
        started_at=now(),
    )
    session.add(run)
    session.flush()

    trigger = trigger_of(graph)
    resource = _resource(rule.resource_type)
    if trigger is None or resource is None:
        run.finished_at = now()
        run.error = "This workflow has no trigger." if trigger is None else (
            f"{rule.resource_type!r} is not a dataset any more.")
        session.flush()
        return serialize_run(run)

    capped = False
    try:
        if records is None:
            first = [
                _by_id(graph)[edge["target"]]
                for edge in _outgoing(graph).get(trigger["id"], [])
            ]
            tree = first[0]["data"].get("tree") if first and first[0]["type"] == "condition" else None
            matches, capped = _matches(session, rule, principal=None, tree=tree)
        else:
            matches = _matches_for(resource, records)
    except ValidationError as error:
        run.finished_at = now()
        run.error = str(error)
        session.flush()
        return serialize_run(run)

    ledger = _cooldown_ledger(session, rule, [match.id for match in matches])
    threshold = now() - timedelta(minutes=max(int(rule.cooldown_minutes or 0), 0))
    suppressed: list[dict[str, Any]] = []
    deferred = 0
    walking = []
    for match in matches:
        entry = ledger.get(match.id)
        if entry is not None and entry.last_fired_at and entry.last_fired_at > threshold:
            suppressed.append({"record": match.label, "record_id": match.id, "path": match.path,
                               "state": "SUPPRESSED", "since": iso(entry.last_fired_at), "actions": []})
            continue
        if len(walking) >= MAX_FIRES:
            deferred += 1
            continue
        walking.append(match)

    walk = Walk(rule=rule, graph=graph, resource=resource, dry_run=dry_run,
                version=graph_row.version, run=run)
    _walk(session, walk, [(trigger["id"], walking)])

    fired = 0
    outcomes: list[dict[str, Any]] = []
    for match in walking:
        entry = walk.records.get(match.id) or {"actions": [], "nodes": []}
        acted = bool(entry["actions"])
        if acted:
            fired += 1
            if not dry_run:
                _remember(session, rule, match, ledger.get(match.id))
        state = ("WOULD FIRE" if dry_run else "FIRED") if acted else "SKIPPED"
        outcomes.append({
            "record": match.label, "record_id": match.id, "path": match.path, "state": state,
            "actions": [{"kind": a["kind"], "ok": a["ok"], "detail": a["detail"], "node_id": a["node_id"]}
                        for a in entry["actions"]],
            "nodes": entry["nodes"],
        })
    sample = (outcomes + suppressed)[: SAMPLE_SIZE]

    run.finished_at = now()
    run.matched = len(matches)
    run.fired = fired
    run.suppressed = len(suppressed)
    run.deferred = deferred
    run.detail = {
        "capped": capped,
        "sample": sample,
        "by_action": _tally(outcomes),
        "nodes": walk.counts,
        "edges": walk.edges_taken,
        "parked": walk.parked,
        "version": graph_row.version,
        "trigger": event or {"event": "MANUAL" if principal is not None else "SCHEDULE"},
    }
    if not dry_run:
        rule.last_match_count = len(matches)
        if fired:
            rule.last_triggered_at = run.finished_at
            rule.trigger_count = int(rule.trigger_count or 0) + fired
    session.flush()
    return serialize_run(run)
