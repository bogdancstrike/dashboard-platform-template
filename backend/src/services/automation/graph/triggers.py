"""Events that start a workflow: a record write, a webhook call."""

from __future__ import annotations

from typing import Any

from sqlalchemy import select

from src.core.errors import NotFoundError, ValidationError
from src.core.pagination import parse_uuid
from src.core.repository import get_or_404
from src.models.automation_graphs import AutomationGraph
from src.models.platform import AlertRule
from src.services.automation.graph.runs import evaluate
from src.services.automation.graph.shape import _ACTIVE, _resource, trigger_of
from src.services.records import writes as record_writes


@record_writes.written.connect
def on_record_write(session, resource, row, changed: set[str], *, created: bool, principal=None) -> int:
    """A record was written: run every published workflow whose trigger matches.

    Never lets a workflow break the write that triggered it — each runs in its
    own savepoint and a failure is recorded on the run, not raised. And never
    runs from inside an automation's own write, so workflows cannot loop.
    """
    if _ACTIVE.get():
        return 0
    from src.core import features

    # Workflows switched off (§27) react to nothing.
    if not features.job_allowed("automation.record-triggers"):
        return 0
    try:
        candidates = session.execute(
            select(AlertRule, AutomationGraph)
            .join(AutomationGraph, AutomationGraph.rule_id == AlertRule.id)
            .where(AlertRule.enabled.is_(True), AlertRule.deleted_at.is_(None),
                   AlertRule.resource_type == resource.key)
        ).unique().all()
    except Exception:  # noqa: BLE001 - an automation must never fail a write
        return 0
    ran = 0
    username = str(getattr(principal, "username", "") or "")
    for rule, graph_row in candidates:
        trigger = trigger_of(graph_row.published)
        if trigger is None:
            continue
        data = trigger.get("data") or {}
        event = str(data.get("event") or "")
        if not _event_matches(event, data, row, changed, created=created, username=username):
            continue
        savepoint = session.begin_nested()
        token = _ACTIVE.set(True)
        try:
            evaluate(session, rule, principal=None, dry_run=False, records=[row],
                     event={"event": event, "record": resource.label_for(row)}, graph_row=graph_row)
            savepoint.commit()
            ran += 1
        except Exception:  # noqa: BLE001 - see the docstring
            savepoint.rollback()
        finally:
            _ACTIVE.reset(token)
    return ran


def _event_matches(event: str, data: dict[str, Any], row, changed: set[str], *, created: bool,
                   username: str) -> bool:
    if event == "RECORD_CREATED":
        return created
    if event == "RECORD_UPDATED":
        return not created and bool(changed)
    if event == "FIELD_CHANGED":
        name = str(data.get("field") or "")
        if created or name not in changed:
            return False
        wanted = data.get("to")
        return wanted in (None, "") or str(getattr(row, name, "")) == str(wanted)
    if event == "FORM_SUBMITTED":
        if not created or not username.startswith("form:"):
            return False
        return not data.get("form") or username == f"form:{data['form']}"
    return False


def fire_webhook(session, token: str, payload: dict[str, Any] | None) -> dict[str, Any]:
    """Another system called a workflow's address: run it for the record it named."""
    row = session.scalar(select(AutomationGraph).where(AutomationGraph.webhook_token == str(token or "")))
    rule = row.rule if row is not None else None
    trigger = trigger_of(row.published) if row is not None else None
    if (rule is None or rule.deleted_at is not None or trigger is None
            or trigger["data"].get("event") != "WEBHOOK"):
        raise NotFoundError("No workflow listens at that address.")
    if not rule.enabled:
        raise ValidationError("That workflow is paused.")
    resource = _resource(rule.resource_type)
    body = payload if isinstance(payload, dict) else {}
    record_id = parse_uuid(body.get("record_id"), field="record_id")
    record = get_or_404(
        session, resource.model, record_id, "That record does not exist.", live=True
    )
    token_ = _ACTIVE.set(True)
    try:
        run = evaluate(session, rule, principal=None, dry_run=False, records=[record],
                       event={"event": "WEBHOOK", "record": resource.label_for(record)}, graph_row=row)
    finally:
        _ACTIVE.reset(token_)
    return {"accepted": True, "run_id": run["id"], "fired": run["fired"]}
