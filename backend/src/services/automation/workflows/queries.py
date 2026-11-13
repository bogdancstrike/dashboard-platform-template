"""Reading rules: the list, one rule, its runs."""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from sqlalchemy import func, select

from src.core.clock import iso, now
from src.models.platform import AlertRule, AlertRuleFire, AlertRuleRun
from src.services.automation.graph.scheduler import catch_up
from src.services.automation.graph.storage import ensure
from src.services.automation.graph.waits import pending_waits
from src.services.automation.workflows.actions import PERMISSION
from src.services.automation.workflows.serializers import _serialize, serialize_run
from src.services.automation.workflows.validation import _rule
from src.services.records.explorer import resource_for


def list_rules(session, args, *, principal) -> dict[str, Any]:
    """Every automation, newest trouble first.

    Not scoped by owner: an automation is an operational object rather than a
    personal one — it emails colleagues and raises tasks in a shared queue, so
    everybody who may write one may see them all. `automations.manage` is the
    whole gate, and *editing* is still the owner's (or an administrator's).
    """
    principal.require(PERMISSION)
    statement = select(AlertRule).where(AlertRule.deleted_at.is_(None))

    resource_type = str(args.get("resource_type") or "").strip()
    if resource_type:
        resource_for(resource_type, principal=principal)
        statement = statement.where(AlertRule.resource_type == resource_type)

    state = str(args.get("state") or "").strip().upper()
    if state == "ENABLED":
        statement = statement.where(AlertRule.enabled.is_(True))
    elif state == "PAUSED":
        statement = statement.where(AlertRule.enabled.is_(False))

    rows = session.scalars(
        statement.order_by(AlertRule.enabled.desc(), AlertRule.name.asc())
    ).unique().all()

    from src.models.automation_graphs import AutomationGraph

    catch_up()
    graphs = {
        row.rule_id: row
        for row in session.scalars(
            select(AutomationGraph).where(AutomationGraph.rule_id.in_([rule.id for rule in rows]))
        ).unique().all()
    } if rows else {}

    return {
        "items": [_serialize(row, principal, graph=graphs.get(row.id)) for row in rows],
        "total": len(rows),
        "counts": _counts(session),
        "can_manage": True,
    }


def _counts(session) -> dict[str, int]:
    """The strip's numbers, computed where the rows are (§71)."""
    live = select(AlertRule).where(AlertRule.deleted_at.is_(None)).subquery()
    row = session.execute(
        select(
            func.count().label("total"),
            func.count().filter(live.c.enabled.is_(True)).label("enabled"),
            func.coalesce(func.sum(live.c.trigger_count), 0).label("fires"),
        ).select_from(live)
    ).one()
    return {"total": int(row.total), "enabled": int(row.enabled), "fires": int(row.fires)}


def get(session, rule_id: Any, *, principal) -> dict[str, Any]:
    principal.require(PERMISSION)
    rule = _rule(session, rule_id)

    detail = _serialize(rule, principal, graph=ensure(session, rule))
    detail["runs"] = [serialize_run(run) for run in rule.runs[:10]]
    detail["waiting"] = pending_waits(session, rule.id)
    detail["cooling_down"] = _cooling_down(session, rule)
    return detail


def _cooling_down(session, rule: AlertRule) -> list[dict[str, Any]]:
    """Which records this rule is currently holding back, and until when.

    The answer to "why has it gone quiet", which is the question a paused-
    looking automation always raises. Derived from the ledger and the rule's
    own cooldown rather than stored: a cooldown somebody shortened has to take
    effect immediately, and a stored expiry would still be yesterday's.
    """
    minutes = max(int(rule.cooldown_minutes or 0), 0)
    if minutes == 0:
        return []
    threshold = now() - timedelta(minutes=minutes)
    rows = session.scalars(
        select(AlertRuleFire)
        .where(AlertRuleFire.rule_id == rule.id, AlertRuleFire.last_fired_at > threshold)
        .order_by(AlertRuleFire.last_fired_at.desc())
        .limit(25)
    ).all()
    return [
        {
            "record_id": row.record_id,
            "record": row.record_label,
            "last_fired_at": iso(row.last_fired_at),
            "until": iso(row.last_fired_at + timedelta(minutes=minutes)),
            "fire_count": int(row.fire_count or 0),
        }
        for row in rows
    ]


def runs(session, rule_id: Any, *, principal, limit: int = 25) -> dict[str, Any]:
    principal.require(PERMISSION)
    rule = _rule(session, rule_id)
    rows = session.scalars(
        select(AlertRuleRun)
        .where(AlertRuleRun.rule_id == rule.id)
        .order_by(AlertRuleRun.started_at.desc())
        .limit(max(1, min(int(limit), 100)))
    ).all()
    return {"items": [serialize_run(row) for row in rows], "total": len(rows)}
