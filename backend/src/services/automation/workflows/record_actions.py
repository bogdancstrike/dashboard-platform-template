"""Actions that change records: a follow-up task, a field update, an assignment, a new record."""

from __future__ import annotations

from typing import Any

from src.core.errors import ValidationError
from src.core.pagination import parse_uuid
from src.models.business import Task
from src.models.platform import AlertRule
from src.services.automation.graph.shape import assignable_field
from src.services.automation.workflows.actions import (
    Match,
    _next_task_reference,
    _owner_principal,
    _text,
)
from src.services.records.explorer import resources


def _task(session, *, rule: AlertRule, match: Match, config: dict[str, Any], **_: Any) -> str:
    """Raise a task, in the same queue every other task lives in."""
    assignee = parse_uuid(config.get("assignee_id"), field="assignee_id") if config.get(
        "assignee_id"
    ) else None
    row = Task(
        reference=_next_task_reference(session),
        title=_text(str(config.get("title") or "{rule}: {record}"), match, rule)[:240],
        description=_text(str(config.get("body") or ""), match, rule) or None,
        status="NEW",
        priority=str(config.get("priority") or "HIGH").upper(),
        kind="TASK",
        assignee_id=assignee,
        requester_id=rule.owner_id,
        metadata_json={"rule_id": str(rule.id), "matched": match.id},
    )
    session.add(row)
    session.flush()
    return row.reference


def _update_field(session, *, rule: AlertRule, match: Match, config: dict[str, Any], **_: Any) -> str:
    """Set one field on the matched record, through the records API's own rules."""
    from src.services.records import writes as record_writes

    resource = resources()[rule.resource_type]
    name = str(config.get("field") or "")
    value = config.get("value")
    if isinstance(value, str):
        value = _text(value, match, rule)
    values, problems = record_writes.coerce(session, resource, {name: value}, creating=False)
    if problems:
        raise ValidationError(problems[0]["message"])
    changed = record_writes.apply_values(
        session, resource, match.row, values, principal=_owner_principal(session, rule)
    )
    return f"{name} set" if changed else f"{name} already set"


def _assign(session, *, rule: AlertRule, match: Match, config: dict[str, Any], **_: Any) -> str:
    """Give the matched record to somebody: a named person, or the rule's owner."""

    resource = resources()[rule.resource_type]
    name = assignable_field(resource)
    if name is None:
        raise ValidationError(f"{resource.label} have nobody to assign.")
    person = config.get("assignee_id") or (str(rule.owner_id) if rule.owner_id else None)
    if not person:
        raise ValidationError("That assignment names nobody.")
    return _update_field(session, rule=rule, match=match, config={"field": name, "value": person})


def _create_record(session, *, rule: AlertRule, match: Match, config: dict[str, Any], **_: Any) -> str:
    """Create a record in any dataset, its text filled in from the match."""
    from src.services.records import writes as record_writes

    values = {
        key: _text(value, match, rule) if isinstance(value, str) else value
        for key, value in (config.get("values") or {}).items()
    }
    created = record_writes.create(
        session, config.get("resource_type"), values, principal=_owner_principal(session, rule)
    )
    return str(created.get("subtitle") or created.get("title") or created.get("id"))
