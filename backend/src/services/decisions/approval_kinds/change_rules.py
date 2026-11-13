"""The rules that decide which edits need approval."""

from __future__ import annotations

from decimal import Decimal, InvalidOperation
from typing import Any

from src.core import audit
from src.core.errors import ValidationError
from src.core.pagination import parse_uuid
from src.core.repository import get_or_404
from src.models.approvals import ChangeRule
from src.services.decisions.approval_kinds.access_requests import (
    CHANGE_DECIDER,
    OPERATORS,
)
from src.services.decisions.approval_kinds.change_requests import _rule_body


def _checked_rule(payload: dict[str, Any], rule: ChangeRule) -> None:
    from src.services.records.explorer import resources

    name = str(payload.get("name", rule.name or "")).strip()
    if not name:
        raise ValidationError("Give the rule a name.", details={"field": "name"})
    resource_type = str(payload.get("resource_type", rule.resource_type or ""))
    resource = resources().get(resource_type)
    if resource is None or not resource.editable:
        raise ValidationError("Choose a dataset that can be edited.", details={"field": "resource_type"})
    field = str(payload.get("field", rule.field or ""))
    if field not in resource.writable:
        raise ValidationError(f"{field!r} is not an editable field of {resource.label}.",
                              details={"field": "field"})
    operator = str(payload.get("operator", rule.operator or "ANY")).upper()
    if operator not in OPERATORS:
        raise ValidationError("Unknown operator.", details={"field": "operator", "allowed": OPERATORS})
    value = payload.get("value", rule.value)
    if operator in ("GT", "LT"):
        try:
            Decimal(str(value))
        except (InvalidOperation, TypeError, ValueError) as exc:
            raise ValidationError("A number is needed for this operator.",
                                  details={"field": "value"}) from exc
    if operator == "IN" and not isinstance(value, list):
        raise ValidationError("A list of values is needed.", details={"field": "value"})
    rule.name = name[:160]
    rule.description = str(payload.get("description", rule.description or "")) or None
    rule.resource_type = resource_type
    rule.field = field
    rule.operator = operator
    rule.value = None if operator == "ANY" else value
    rule.active = bool(payload.get("active", True if rule.active is None else rule.active))


def save_rule(session, payload: dict[str, Any], *, principal, rule_id: Any = None) -> dict[str, Any]:
    principal.require(CHANGE_DECIDER)
    if rule_id:
        rule = get_or_404(
            session,
            ChangeRule,
            parse_uuid(rule_id, field="rule_id"),
            "That rule does not exist.",
            live=True,
        )
    else:
        rule = ChangeRule(created_by_id=principal.user_id, active=True)
    _checked_rule(payload, rule)
    if not rule_id:
        session.add(rule)
    session.flush()
    audit.record(session, action="CONFIGURATION_CHANGE", resource_type="change_rule",
                 resource_id=rule.id, resource_label=rule.name, principal=principal,
                 after=_rule_body(rule), message=f"saved approval rule {rule.name}")
    return _rule_body(rule)


def delete_rule(session, rule_id: Any, *, principal) -> dict[str, Any]:
    from src.core.clock import now

    principal.require(CHANGE_DECIDER)
    rule = get_or_404(
        session,
        ChangeRule,
        parse_uuid(rule_id, field="rule_id"),
        "That rule does not exist.",
        live=True,
    )
    rule.deleted_at = now()
    audit.record(session, action="DELETE", resource_type="change_rule", resource_id=rule.id,
                 resource_label=rule.name, principal=principal, message=f"removed approval rule {rule.name}")
    return {"id": str(rule.id), "removed": True}
