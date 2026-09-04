"""One record, in full (§8).

The list side of every entity is already generic: `services/explorer.py`
declares each dataset once and `core/query.py` turns that declaration into SQL,
facets, sorting and a filter vocabulary. This is the other half — opening one
row — and it reads the *same* declaration, so a field that can be filtered on
the list is a field that appears on the detail page, and adding a column to an
entity makes it appear on both with no further work.

What it deliberately does not do is invent a presentation. The server sends
every declared field with its label, kind and value, plus which of them names
the record and which carries its state; how those are laid out is the
frontend's business. A backend that also decides the column order is a backend
that has to be redeployed to move a field.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import select

from src.core.errors import NotFoundError
from src.core.pagination import parse_uuid
from src.services.explorer import Resource, resource_for


def detail(session, resource_type: Any, record_id: Any, *, principal) -> dict[str, Any]:
    """One record: every declared field, labelled, with what to call it."""
    resource = resource_for(resource_type, principal=principal)
    identifier = parse_uuid(record_id, field="record_id")

    row = session.scalars(_lookup(resource, identifier)).first()
    if row is None:
        # Deliberately the same answer as "you may not see it": whether a
        # record exists is itself information (§76).
        raise NotFoundError(
            f"That {resource.label.rstrip('s').lower()} does not exist.",
            details={"resource_type": resource.key, "id": str(identifier)},
        )

    from src.services.explorer import _json_value

    fields = [
        {
            "name": spec.name,
            "label": spec.title,
            "kind": spec.kind,
            "value": _json_value(getattr(row, spec.name, None)),
        }
        for spec in resource.fields.fields
    ]

    return {
        "id": str(row.id),
        "resource_type": resource.key,
        "resource_label": resource.label,
        "path": resource.path,
        "title": resource.label_for(row),
        "subtitle": _value_of(row, resource.subtitle_field),
        "status": _value_of(row, resource.status_field),
        "title_field": resource.title_field,
        "status_field": resource.status_field,
        "fields": fields,
        "created_at": _json_value(getattr(row, "created_at", None)),
        "updated_at": _json_value(getattr(row, "updated_at", None)),
    }


def _lookup(resource: Resource, identifier):
    statement = select(resource.model).where(resource.model.id == identifier)
    deleted = getattr(resource.model, "deleted_at", None)
    # A soft-deleted record is gone as far as the application is concerned;
    # only the audit trail remembers it.
    return statement.where(deleted.is_(None)) if deleted is not None else statement


def _value_of(row: Any, name: str) -> str:
    value = getattr(row, name, None) if name else None
    return "" if value is None else str(value)
