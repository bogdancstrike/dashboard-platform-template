"""Inserting a row with its server-made identifier; audit state and messages."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from src.core.errors import ConflictError, NotFoundError, ValidationError
from src.core.naming import identifier, sequence_of
from src.core.pagination import parse_uuid
from src.services.records.explorer import Identity, Resource
from src.services.records.writes.events import (
    _IDENTIFIER_ATTEMPTS,
    CONCURRENCY_KEY,
)


def _insert(session, resource: Resource, values: dict[str, Any]):
    """Add the row, retrying only the one failure that is a race.

    Each attempt runs inside a SAVEPOINT so a lost race rolls back the insert
    alone: a plain `rollback()` here would also discard the audit rows of
    anything else the request had already written. A violation of any other
    constraint is re-raised — retrying it five times would turn one clear
    database error into a misleading "could not allocate an identifier".
    """
    identity: Identity = resource.identity  # type: ignore[assignment]

    for attempt in range(_IDENTIFIER_ATTEMPTS):
        savepoint = session.begin_nested()
        row = resource.model(**values)
        setattr(row, identity.field, _next_identifier(session, resource))
        session.add(row)
        try:
            session.flush()
        except IntegrityError as exc:
            savepoint.rollback()
            if identity.field not in str(getattr(exc, "orig", exc)):
                raise
            if attempt == _IDENTIFIER_ATTEMPTS - 1:
                raise ConflictError(
                    f"Could not allocate a {identity.field} for the new "
                    f"{_singular(resource)}. Try again.",
                    details={"resource_type": resource.key},
                ) from exc
        else:
            savepoint.commit()
            return row
    raise AssertionError("unreachable")  # pragma: no cover


def _next_identifier(session, resource: Resource) -> str:
    """One past the highest already issued.

    `MAX()` over a fixed-width, zero-padded, indexed column is an index scan
    rather than a table read, which is the whole reason `core/naming` pads.
    """
    identity: Identity = resource.identity  # type: ignore[assignment]
    column = getattr(resource.model, identity.field)
    highest = session.scalar(
        select(func.max(column)).where(column.like(f"{identity.prefix}-%"))
    )
    return identifier(
        identity.prefix,
        sequence_of(highest, prefix=identity.prefix) + 1,
        width=identity.width,
    )


def _refuse_a_lost_race(resource: Resource, row: Any, expected: Any) -> None:
    """Refuse an edit written against a version that has since moved on (§73)."""
    if not expected:
        return
    current = getattr(row, "updated_at", None)
    if current is None:  # pragma: no cover - every entity is timestamped
        return
    try:
        seen = datetime.fromisoformat(str(expected).replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValidationError(
            f"{CONCURRENCY_KEY} must be a timestamp.",
            details={CONCURRENCY_KEY: str(expected)},
        ) from exc
    if seen.tzinfo is None:
        seen = seen.replace(tzinfo=UTC)
    # Timestamps round-trip through JSON at microsecond precision, so a
    # millisecond is ample slack. It used to be a whole second, which let a
    # second save of the same version through whenever it came within a
    # second of the first — exactly when two people race.
    if abs((current - seen).total_seconds()) > 0.001:
        raise ConflictError(
            f"Somebody else changed this {_singular(resource)} while you were editing it.",
            details={
                "resource_type": resource.key,
                "id": str(row.id),
                "expected": seen.isoformat(),
                "current": current.isoformat(),
            },
        )


def _load(session, resource: Resource, record_id: Any, *, lock: bool = False):
    from src.services.records.detail import _lookup

    statement = _lookup(resource, parse_uuid(record_id, field="record_id"))
    if lock:
        # `of=`: only the record's own row, never an eagerly joined one.
        statement = statement.with_for_update(of=resource.model)
    row = session.scalars(statement).first()
    if row is None:
        raise NotFoundError(
            f"That {_singular(resource)} does not exist.",
            details={"resource_type": resource.key, "id": str(record_id)},
        )
    return row


def _state(resource: Resource, row: Any, only: dict[str, Any] | None = None) -> dict[str, Any]:
    """The audit diff's view of a record: the writable fields, serialised."""
    from src.services.records.explorer import _json_value

    names = list(only) if only is not None else [spec.name for spec in resource.editable]
    return {name: _json_value(getattr(row, name, None)) for name in names}


def _message_for(resource: Resource, row: Any, changed: set[str], after: dict[str, Any]) -> str:
    """What the ledger and the activity feed say happened, in words."""
    label = resource.label_for(row)
    if changed == {resource.status_field}:
        return f"moved {label} to {after.get(resource.status_field)}"
    return f"updated {label} ({', '.join(sorted(changed))})"


def _singular(resource: Resource) -> str:
    return resource.label.rstrip("s").lower()
