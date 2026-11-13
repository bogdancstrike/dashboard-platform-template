"""Change requests: holding a record edit that a rule says needs approval."""

from __future__ import annotations

from decimal import Decimal, InvalidOperation
from typing import Any

from sqlalchemy import select

from src.core.clock import iso
from src.models.approvals import ApprovalRequest, ChangeRule
from src.services.decisions import approvals
from src.services.decisions.approval_kinds.access_requests import (
    CHANGE_DECIDER,
    OPERATORS,
)
from src.services.decisions.approvals import Provider
from src.services.records import writes as record_writes


def _matches(rule: ChangeRule, before: Any, after: Any) -> bool:
    if before == after:
        return False
    if rule.operator == "ANY":
        return True
    if rule.operator == "EQUALS":
        return str(after) == str(rule.value)
    if rule.operator == "IN":
        return str(after) in {str(item) for item in (rule.value or [])}
    try:
        number = Decimal(str(after))
        bound = Decimal(str(rule.value))
    except (InvalidOperation, TypeError, ValueError):
        return False
    return number > bound if rule.operator == "GT" else number < bound


@record_writes.update_requested.connect
def intercept(session, resource, row, values: dict[str, Any], raw: dict[str, Any], *,
              principal) -> dict[str, Any] | None:
    """Hold an edit back when a rule says it needs approval.

    Returns the change request it raised, or `None` to let the edit through.
    People who could approve it themselves are not held up by it — the rule is
    a second pair of eyes, and theirs are the eyes.
    """
    if principal.can(CHANGE_DECIDER):
        return None
    rules = session.scalars(
        select(ChangeRule).where(
            ChangeRule.resource_type == resource.key,
            ChangeRule.active.is_(True),
            ChangeRule.deleted_at.is_(None),
        )
    ).all()
    if not rules:
        return None
    from src.core.audit import jsonable

    hits = [
        rule for rule in rules
        if rule.field in values and _matches(rule, jsonable(getattr(row, rule.field, None)),
                                             jsonable(values[rule.field]))
    ]
    if not hits:
        return None
    held = {name: raw[name] for name in values if name in raw}
    label = resource.label_for(row)
    before = {name: jsonable(getattr(row, name, None)) for name in held}
    existing = approvals.find_pending(session, kind="change", subject_type=resource.key,
                                      subject_id=row.id)
    if existing is not None and str(existing.requester_id) == str(principal.user_id):
        existing.payload = {**(existing.payload or {}), "values": {**(existing.payload or {}).get("values", {}), **held}}
        session.flush()
        return approvals.serialize(existing, principal=principal)
    request = approvals.submit(
        session,
        kind="change",
        requester_id=principal.user_id,
        requester_label=principal.full_name,
        title=f"Change {label}: {', '.join(sorted(held))}",
        summary="; ".join(rule.name for rule in hits),
        subject_type=resource.key,
        subject_id=row.id,
        subject_label=label,
        link=f"{resource.path}/{row.id}",
        payload={"resource_type": resource.key, "record_id": str(row.id), "values": held,
                 "before": before, "rules": [str(rule.id) for rule in hits]},
    )
    return approvals.serialize(request, principal=principal)


def _apply_change(session, row: ApprovalRequest, *, approved: bool, principal, comment: str) -> None:
    if not approved:
        return
    from src.services.records.explorer import resource_for

    payload = row.payload or {}
    resource = resource_for(payload.get("resource_type"))
    record = record_writes._load(session, resource, payload.get("record_id"))
    values = record_writes._coerced(session, resource, dict(payload.get("values") or {}),
                                    creating=False)
    record_writes.apply_values(session, resource, record, values, principal=principal)


def _describe_change(session, row: ApprovalRequest) -> dict[str, Any]:
    payload = row.payload or {}
    before = payload.get("before") or {}
    return {
        "changes": [
            {"field": name, "before": before.get(name), "after": value}
            for name, value in (payload.get("values") or {}).items()
        ]
    }


def _rule_body(rule: ChangeRule) -> dict[str, Any]:
    return {
        "id": str(rule.id), "name": rule.name, "description": rule.description or "",
        "resource_type": rule.resource_type, "field": rule.field, "operator": rule.operator,
        "value": rule.value, "active": rule.active, "created_at": iso(rule.created_at),
    }


def _field_body(resource, name: str) -> dict[str, Any]:
    field = resource.fields.by_name.get(name)
    if field is None:  # pragma: no cover - a writable field is always declared
        return {"name": name, "label": name, "kind": "text", "choices": []}
    return {"name": name, "label": field.title, "kind": field.kind, "choices": list(field.choices)}


def rules(session, *, principal) -> dict[str, Any]:
    from src.services.records.explorer import resources

    rows = session.scalars(
        select(ChangeRule).where(ChangeRule.deleted_at.is_(None)).order_by(ChangeRule.created_at)
    ).all()
    catalogue = [
        {
            "resource_type": key,
            "label": resource.label,
            "fields": [_field_body(resource, spec.name) for spec in resource.editable],
        }
        for key, resource in resources().items() if resource.editable
    ]
    return {"items": [_rule_body(rule) for rule in rows], "catalogue": catalogue,
            "operators": list(OPERATORS), "can_manage": principal.can(CHANGE_DECIDER)}


approvals.register(Provider(kind="change", label="Change requests", icon="pen",
                            decide_permission=CHANGE_DECIDER, sla_hours=24, apply=_apply_change,
                            describe=_describe_change))
