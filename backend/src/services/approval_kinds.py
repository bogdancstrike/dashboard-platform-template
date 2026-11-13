"""The built-in kinds of approval: access, held-back changes, report publishing.

Each is a `Provider` (see `services/approvals`) plus the entry point that
raises it. Timesheets register themselves from `services/timekeeping`.

**Access requests** come from a forbidden page: the reader asks for the
permission that page needed. Approving one adds the requester to a governance
group named for that permission — created on first use — so the grant is
visible, revocable and audited in the groups screen rather than being a quiet
edit to somebody's role.

**Change requests** are record edits a `ChangeRule` holds back. The values are
kept exactly as submitted and re-coerced when approved, so an edit approved a
day later is validated against the record as it is then.

**Report publishing** is the step from a private report to one the whole
organisation reads.
"""

from __future__ import annotations

from decimal import Decimal, InvalidOperation
from typing import Any

from sqlalchemy import select

from src.core import audit
from src.core.auth import ALL_PERMISSIONS, PERMISSION_LABELS
from src.core.clock import iso
from src.core.errors import ConflictError, NotFoundError, ValidationError
from src.core.pagination import parse_uuid
from src.core.repository import get_or_404
from src.models.approvals import ApprovalRequest, ChangeRule
from src.services import approvals, record_writes
from src.services.approvals import Provider

ACCESS_DECIDER = "roles.manage"
CHANGE_DECIDER = "approvals.decide"
OPERATORS = ("ANY", "EQUALS", "IN", "GT", "LT")


# ── Access ──────────────────────────────────────────────────────────────


def _access_group(session, permission: str):
    from src.models.identity import Group

    slug = f"access-{permission.replace('.', '-')}"
    group = session.scalars(select(Group).where(Group.slug == slug)).first()
    if group is None:
        group = Group(
            name=f"Access: {PERMISSION_LABELS.get(permission, permission)}"[:120],
            slug=slug,
            description=f"Granted through approved access requests for {permission}.",
            kind="GOVERNANCE",
            permissions=[permission],
            color="#7c3aed",
        )
        session.add(group)
        session.flush()
    elif group.deleted_at is not None:
        group.deleted_at = None
    if permission not in (group.permissions or []):
        group.permissions = [*(group.permissions or []), permission]
    return group


def _apply_access(session, row: ApprovalRequest, *, approved: bool, principal, comment: str) -> None:
    if not approved:
        return
    from src.models.identity import User

    user = get_or_404(session, User, row.requester_id, "The person who asked no longer exists.")
    permission = (row.payload or {}).get("permission")
    group = _access_group(session, permission)
    if user not in group.members:
        group.members.append(user)
    session.flush()
    audit.record(
        session,
        action="PERMISSION_CHANGE",
        resource_type="group",
        resource_id=group.id,
        resource_label=group.name,
        principal=principal,
        after={"added_member": user.full_name, "permission": permission},
        message=f"granted {permission} to {user.full_name} through {row.reference}",
    )


def _describe_access(session, row: ApprovalRequest) -> dict[str, Any]:
    payload = row.payload or {}
    permission = payload.get("permission", "")
    return {
        "facts": [
            {"label": "Permission", "value": PERMISSION_LABELS.get(permission, permission)},
            {"label": "Code", "value": permission},
            {"label": "Asked from", "value": payload.get("path") or "—"},
            {"label": "Granted through", "value": f"Access: {PERMISSION_LABELS.get(permission, permission)} group"},
        ]
    }


def request_access(session, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    """Ask for a permission from a page that needed it."""
    permission = str(payload.get("permission") or "").strip()
    if permission not in ALL_PERMISSIONS:
        raise ValidationError(f"{permission!r} is not a permission.", details={"field": "permission"})
    if principal.can(permission):
        raise ConflictError("You already have this permission.", details={"permission": permission})
    reason = str(payload.get("reason") or "").strip()[:1000]
    path = str(payload.get("path") or "").strip()[:300]
    existing = session.scalars(
        select(ApprovalRequest).where(
            ApprovalRequest.kind == "access",
            ApprovalRequest.requester_id == principal.user_id,
            ApprovalRequest.status == "PENDING",
            ApprovalRequest.subject_id == permission,
        )
    ).first()
    if existing is not None:
        return {**approvals.serialize(existing, principal=principal), "already_pending": True}
    label = PERMISSION_LABELS.get(permission, permission)
    row = approvals.submit(
        session,
        kind="access",
        requester_id=principal.user_id,
        requester_label=principal.full_name,
        title=f"Access: {label}",
        summary=reason or f"Asked for from {path or 'a page that needed it'}.",
        subject_type="permission",
        subject_id=permission,
        subject_label=label,
        link=path or None,
        payload={"permission": permission, "path": path, "reason": reason},
    )
    return {**approvals.serialize(row, principal=principal), "already_pending": False}


# ── Change requests ─────────────────────────────────────────────────────


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
    from src.services.explorer import resource_for

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
    from src.services.explorer import resources

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


def _checked_rule(payload: dict[str, Any], rule: ChangeRule) -> None:
    from src.services.explorer import resources

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


# ── Report publishing ───────────────────────────────────────────────────


def _apply_report(session, row: ApprovalRequest, *, approved: bool, principal, comment: str) -> None:
    if not approved:
        return
    from src.models.personal import Report

    report = get_or_404(
        session,
        Report,
        parse_uuid((row.payload or {}).get("report_id"), field="report_id"),
        "The report no longer exists.",
        live=True,
    )
    report.scope = (row.payload or {}).get("scope") or "ORGANIZATION"
    audit.record(session, action="UPDATE", resource_type="report", resource_id=report.id,
                 resource_label=report.name, principal=principal,
                 after={"scope": report.scope}, message=f"published {report.name} through {row.reference}")


def request_publish(session, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    from src.models.personal import Report

    report = session.get(Report, parse_uuid(payload.get("report_id"), field="report_id"))
    if report is None or report.deleted_at is not None or report.owner_id != principal.user_id:
        raise NotFoundError("That report does not exist, or is not yours to publish.")
    if report.scope == "ORGANIZATION":
        raise ConflictError("This report is already published to the organisation.")
    existing = approvals.find_pending(session, kind="report", subject_type="report", subject_id=report.id)
    if existing is not None:
        return {**approvals.serialize(existing, principal=principal), "already_pending": True}
    row = approvals.submit(
        session, kind="report", requester_id=principal.user_id, requester_label=principal.full_name,
        title=f"Publish report: {report.name}",
        summary=str(payload.get("reason") or "") or "Share this report with the whole organisation.",
        subject_type="report", subject_id=report.id, subject_label=report.name,
        link=f"/reports?report={report.id}",
        payload={"report_id": str(report.id), "scope": "ORGANIZATION", "from_scope": report.scope},
    )
    return {**approvals.serialize(row, principal=principal), "already_pending": False}


def _describe_report(session, row: ApprovalRequest) -> dict[str, Any]:
    payload = row.payload or {}
    return {"facts": [
        {"label": "Currently", "value": str(payload.get("from_scope") or "PRIVATE").title()},
        {"label": "Becomes", "value": "Organisation-wide"},
    ]}


approvals.register(Provider(kind="access", label="Access requests", icon="key",
                            decide_permission=ACCESS_DECIDER, sla_hours=24, apply=_apply_access,
                            describe=_describe_access))
approvals.register(Provider(kind="change", label="Change requests", icon="pen",
                            decide_permission=CHANGE_DECIDER, sla_hours=24, apply=_apply_change,
                            describe=_describe_change))
approvals.register(Provider(kind="report", label="Report publishing", icon="report",
                            decide_permission=CHANGE_DECIDER, sla_hours=72, apply=_apply_report,
                            describe=_describe_report))
