"""Applying values to a row, deleting, and the after-write hooks."""

from __future__ import annotations

from typing import Any

from src.core import audit
from src.core.clock import now
from src.core.errors import ValidationError
from src.services.records.explorer import Resource, resource_for
from src.services.records.writes.events import DELETE_PERMISSION, derived, written
from src.services.records.writes.identity import _load, _message_for, _state


def apply_values(
    session, resource: Resource, row: Any, values: dict[str, Any], *, principal
) -> set[str]:
    """Set already-coerced values on a loaded row and audit what moved.

    Extracted from `update` so that the bulk path (§43) writes the *same* thing
    a single edit does, down to the audit action: "a move between lanes is a
    status change" is a decision, and a second implementation of it would have
    fifty cards in the ledger as edits while one card is a move. Returns the
    names that actually changed, so a caller can tell "applied" from
    "already had that value".

    What it deliberately does not do is read the record back. `update` returns
    the whole detail payload because a form needs it; a bulk of two hundred
    would be two hundred detail reads for a screen that shows a count.
    """
    before = _state(resource, row, only=values)
    for name, value in values.items():
        setattr(row, name, value)
    after = _state(resource, row, only=values)

    changed = {name for name in values if before.get(name) != after.get(name)}
    if not changed:
        return changed

    session.flush()
    _after_write(session, resource, row, changed)
    audit.record(
        session,
        # A move between lanes is a status change, and reads as one in the
        # ledger. Anything wider is an edit.
        action="STATUS_CHANGE" if changed == {resource.status_field} else "UPDATE",
        resource_type=resource.key,
        resource_id=row.id,
        resource_label=resource.label_for(row),
        principal=principal,
        before=before,
        after=after,
        message=_message_for(resource, row, changed, after),
    )
    session.flush()
    _automations(session, resource, row, changed, created=False, principal=principal)
    return changed


def _after_write(session, resource: Resource, row: Any, changed: set[str]) -> None:
    """What other features derive from a record (a ticket's SLA clock)."""
    derived.emit(session, resource, row, changed)


def _automations(session, resource: Resource, row: Any, changed: set[str], *, created: bool,
                 principal) -> None:
    """Workflows whose trigger is this write (§49): created, updated, a field changed."""
    written.emit(session, resource, row, changed, created=created, principal=principal)


def delete(session, resource_type: Any, record_id: Any, *, principal) -> dict[str, Any]:
    """Soft-delete: gone from every list, still readable by the audit trail."""
    resource = resource_for(resource_type, principal=principal)
    principal.require(DELETE_PERMISSION)
    row = _load(session, resource, record_id)
    label = remove_row(session, resource, row, principal=principal)
    return {"id": str(row.id), "resource_type": resource.key, "deleted": True, "title": label}


def remove_row(session, resource: Resource, row: Any, *, principal) -> str:
    """Soft-delete one loaded row, audited. Shared with the bulk path (§43)."""
    if not hasattr(row, "deleted_at"):  # pragma: no cover - every entity has it
        raise ValidationError(
            f"{resource.label} cannot be deleted.", details={"resource_type": resource.key}
        )

    label = resource.label_for(row)
    row.deleted_at = now()
    audit.record(
        session,
        action="DELETE",
        resource_type=resource.key,
        resource_id=row.id,
        resource_label=label,
        principal=principal,
        before={"deleted": False},
        after={"deleted": True},
        message=f"deleted {label}",
    )
    session.flush()
    return label
