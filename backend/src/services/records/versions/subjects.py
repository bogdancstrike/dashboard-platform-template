"""Which records have versions, and the audit rows that hold them."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable

from sqlalchemy import select

from src.core import audit
from src.core.errors import NotFoundError, ValidationError

RESTORE_PERMISSION = "records.restore"


#: The audit rows read for one record. Far more than any record in the demo
#: has; a cap rather than an unbounded read.
MAX_ROWS = 500


@dataclass
class Subject:
    """What version history needs to know about one kind of record."""

    key: str
    label: str
    fields: dict[str, dict[str, Any]]
    row: Any
    title: str
    current: dict[str, Any]
    edit_permission: str
    apply: Callable[..., set[str]]


def _subject(session, resource_type: str, record_id: Any, *, principal) -> Subject:
    if resource_type == "contract":
        from src.services.records import contracts

        principal.require(contracts.VIEW)
        row = contracts.load(session, record_id)

        def apply_contract(values: dict[str, Any], *, metadata, message) -> set[str]:
            coerced = contracts.coerce(session, values, creating=False)
            return contracts.apply(session, row, coerced, principal=principal, action="RESTORE",
                                   message=message, metadata=metadata)

        kinds = {
            "text": "text", "longtext": "text", "customer": "uuid", "user": "uuid", "money": "number",
            "currency": "enum", "date": "datetime", "int": "number", "billing": "enum", "bool": "bool",
            "stage": "enum", "percent": "number",
        }
        refs = {"customer_id": "customer", "owner_id": "user"}
        return Subject(
            key="contract", label="Contract",
            fields={name: {"name": name, "label": contracts.LABELS[name], "kind": kinds[kind],
                           "references": refs.get(name, "")}
                    for name, kind in contracts.FIELDS.items()},
            row=row, title=f"{row.reference} — {row.title}", current=contracts.state(row),
            edit_permission=contracts.MANAGE, apply=apply_contract,
        )

    from src.services.records import writes as writes
    from src.services.records.explorer import references_of, resource_for

    resource = resource_for(resource_type, principal=principal)
    if not resource.editable:
        raise ValidationError(f"{resource.label} have no editable fields to version.",
                              details={"resource_type": resource.key})
    row = writes._load(session, resource, record_id)

    def apply_record(values: dict[str, Any], *, metadata, message) -> set[str]:
        try:
            coerced, problems = writes.coerce(session, resource, values, creating=False)
        except NotFoundError as missing:
            # A reference the old version held has since been deleted.
            raise ValidationError(f"That version cannot be restored: {missing.message}",
                                  details=dict(missing.details)) from missing
        if problems:
            first = problems[0]
            raise ValidationError(
                f"That version cannot be restored: {first['message']}",
                details={"problems": problems, **dict(first.get("details") or {})},
            )
        before = writes._state(resource, row, only=coerced)
        for name, value in coerced.items():
            setattr(row, name, value)
        after = writes._state(resource, row, only=coerced)
        changed = {name for name in coerced if before.get(name) != after.get(name)}
        if not changed:
            return changed
        session.flush()
        writes._after_write(session, resource, row, changed)
        audit.record(
            session, action="RESTORE", resource_type=resource.key, resource_id=row.id,
            resource_label=resource.label_for(row), principal=principal,
            before={k: before[k] for k in changed}, after={k: after[k] for k in changed},
            message=message, metadata=metadata,
        )
        session.flush()
        return changed

    fields = {}
    for spec in resource.editable:
        field = resource.fields.by_name[spec.name]
        fields[spec.name] = {"name": spec.name, "label": field.title, "kind": field.kind,
                             "references": references_of(field) if field.kind == "uuid" else ""}
    return Subject(
        key=resource.key, label=resource.label.rstrip("s"), fields=fields, row=row,
        title=resource.label_for(row), current=writes._state(resource, row),
        edit_permission=writes.UPDATE_PERMISSION, apply=apply_record,
    )


def _audit_rows(session, subject: Subject) -> list[Any]:
    from src.models.platform import AuditLog

    rows = session.scalars(
        select(AuditLog)
        .where(AuditLog.resource_type == subject.key, AuditLog.resource_id == str(subject.row.id),
               AuditLog.result == "SUCCESS")
        .order_by(AuditLog.occurred_at.desc(), AuditLog.created_at.desc())
        .limit(MAX_ROWS)
    ).all()
    return list(reversed(rows))


def _touched(row, fields: dict[str, Any]) -> dict[str, Any]:
    """The `from` value of every versioned field this audit row changed."""
    changes = row.changes or {}
    out = {name: change.get("from") for name, change in changes.items()
           if name in fields and isinstance(change, dict)}
    if not out and row.state_before:
        out = {name: value for name, value in row.state_before.items() if name in fields}
    if not out and row.state_after and row.action != "CREATE":
        out = {name: None for name in row.state_after if name in fields}
    return out
