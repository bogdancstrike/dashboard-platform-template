"""Creating, editing and deleting one record (§9, §73).

The read half (`services/records.py`) renders whatever a `Resource` declares.
This is the mirror of it: what a form may *write* is declared on the same
resource, so the fields an edit form offers are the fields the API accepts and
neither list can drift from the other.

Four decisions are worth the reader's attention.

**A payload is coerced against the declaration, never trusted.** The field
already knows its kind and, for an enum, its closed vocabulary; the write
declaration adds the bounds. So "status must be one of these seven" is
enforced by the same tuple the filter menu is built from, and adding a status
to the vocabulary makes it settable without touching this module.

**Foreign keys are checked before the INSERT, from the schema.** A dangling
`assignee_id` would otherwise reach PostgreSQL and come back as an
`IntegrityError` — a 500 for what is plainly a bad form value. The target
table comes from the column's own `ForeignKey`, so a new relation is validated
the day it is declared rather than the day somebody remembers this file.

**An edit that lost a race is refused, not applied.** A client may send the
`updated_at` it last saw; if the row has moved on, the write is a 409 naming
both moments. Without that, two people dragging the same card produce a last
write that silently discards the first — the failure §73 exists to prevent.

**The human identifier is generated, never accepted.** `TSK-00042` is the
string people quote to each other, so the server owns it: the highest existing
one plus one, retried if another request took the same number in between.
"""

from __future__ import annotations

from datetime import UTC, date, datetime
from decimal import Decimal, InvalidOperation
from typing import Any
from uuid import UUID

from sqlalchemy import Integer, Numeric, String, Text, func, select
from sqlalchemy.exc import IntegrityError

from src.core import audit
from src.core.clock import now
from src.core.errors import ConflictError, NotFoundError, ValidationError
from src.core.naming import identifier, sequence_of
from src.core.pagination import parse_uuid
from src.core.query import Field
from src.services.explorer import Identity, Resource, Writable, resource_for
from src.services.records import detail

CREATE_PERMISSION = "records.create"
UPDATE_PERMISSION = "records.update"
DELETE_PERMISSION = "records.delete"

#: How many times a create retries after losing the race for an identifier.
#: Two concurrent creates is ordinary; a hundred is a different problem, and a
#: loop that hides one is worse than an error that reports it.
_IDENTIFIER_ATTEMPTS = 5

#: Sent by a client that read the record first, to say which version it edited.
CONCURRENCY_KEY = "expected_updated_at"


def create(session, resource_type: Any, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    """Write a new record, named by the server, audited in the same transaction."""
    resource = resource_for(resource_type, principal=principal)
    principal.require(CREATE_PERMISSION)
    if resource.identity is None:
        raise ValidationError(
            f"{resource.label} cannot be created here.",
            details={"resource_type": resource.key},
        )

    values = _coerced(session, resource, _object(payload), creating=True)
    row = _insert(session, resource, values)

    audit.record(
        session,
        action="CREATE",
        resource_type=resource.key,
        resource_id=row.id,
        resource_label=resource.label_for(row),
        principal=principal,
        after=_state(resource, row),
        message=f"created {resource.label_for(row)}",
    )
    session.flush()
    return detail(session, resource.key, row.id, principal=principal)


def create_many(
    session, resource_type: Any, payloads: list[dict[str, Any]], *, principal
) -> list[Any]:
    """Create several records by exactly the rules that create one (§29).

    What the import wizard's execute calls. Three things it does differently
    from `create` in a loop, and each is the reason it exists:

    **It re-coerces.** The importer has already validated every row, so a
    failure here is either a bug or a race — a foreign key that was valid at
    the preview step and deleted before the execute. Re-checking costs almost
    nothing beside the INSERT and means staged JSON that has been tampered with
    between wizard steps cannot write something the rules refuse.

    **It does not read each record back.** `create` answers with `detail`,
    which is right for a form that is about to render the result and wrong five
    thousand times over. The caller gets the rows.

    **It raises rather than continuing.** Callers wanting a partial result must
    say so by validating first, which the wizard does: the preview is where a
    bad row is reported, and by the execute the contract is all-or-nothing.
    Half an import is the outcome §29 exists to prevent — a spreadsheet loaded
    twice because nobody could tell how much of it landed the first time.
    """
    resource = resource_for(resource_type, principal=principal)
    principal.require(CREATE_PERMISSION)
    if resource.identity is None:
        raise ValidationError(
            f"{resource.label} cannot be created here.",
            details={"resource_type": resource.key},
        )

    rows = []
    for index, payload in enumerate(payloads):
        values = _coerced(session, resource, _object(payload), creating=True)
        row = _insert(session, resource, values)
        audit.record(
            session,
            action="CREATE",
            resource_type=resource.key,
            resource_id=row.id,
            resource_label=resource.label_for(row),
            principal=principal,
            after=_state(resource, row),
            message=f"created {resource.label_for(row)}",
            # One activity entry for the import as a whole, written by the
            # caller: five thousand lines of "created CUS-01234" is a feed
            # nobody can read (§48).
            activity=False,
            metadata={"import_row": index + 1},
        )
        rows.append(row)

    session.flush()
    return rows


def update(
    session, resource_type: Any, record_id: Any, payload: dict[str, Any], *, principal
) -> dict[str, Any]:
    """Change the declared fields a payload names. Everything else is refused."""
    resource = resource_for(resource_type, principal=principal)
    principal.require(UPDATE_PERMISSION)

    body = _object(payload)
    row = _load(session, resource, record_id)
    _refuse_a_lost_race(resource, row, body.get(CONCURRENCY_KEY))

    values = _coerced(session, resource, body, creating=False)
    apply_values(session, resource, row, values, principal=principal)
    return detail(session, resource.key, row.id, principal=principal)


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
    return changed


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


# ── validation ───────────────────────────────────────────────────────────


def _object(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise ValidationError("The record must be a JSON object.")
    return payload


def coerce(
    session, resource: Resource, payload: dict[str, Any], *, creating: bool
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """Every writable field the payload names, converted — and every problem.

    The same loop `_coerced` uses, differing only in what it does with a
    failure: this collects them all, that raises the first. Both exist because
    a form and an import want opposite things from the same rules.

    A form wants the first error and wants it now: the person is looking at the
    field, and thirty messages about a payload they sent one field of would be
    noise. An import wants every error on every row *before* anything is
    written — "row 14 has a bad status" followed by "row 14 also has a bad
    date" one execute later is a wizard somebody goes round twice.

    What must not happen is two sets of rules. An importer that validated a CSV
    itself would accept rows a form refuses, and the first anybody would hear
    of it is a 500 during the execute — so this is the one place the coercion
    lives, and `services/imports` calls exactly this.
    """
    writable = resource.writable
    if not writable:
        return {}, [
            {
                "field": "",
                "message": f"{resource.label} are read-only.",
                "details": {"resource_type": resource.key},
            }
        ]

    problems: list[dict[str, Any]] = []
    unknown = sorted(set(payload) - set(writable) - {CONCURRENCY_KEY})
    if unknown:
        # Not a per-field problem: a payload naming a field that does not exist
        # is a caller that has the wrong idea about the resource, and answering
        # per field would bury that.
        return {}, [
            {
                "field": "",
                "message": "Those fields cannot be written.",
                "details": {"fields": unknown, "editable": sorted(writable)},
            }
        ]

    values: dict[str, Any] = {}
    for name, spec in writable.items():
        field = resource.fields.by_name[name]
        if name not in payload:
            if creating and spec.required:
                problems.append(
                    {
                        "field": name,
                        "message": f"{field.title} is required.",
                        "details": {"field": name},
                    }
                )
            continue
        try:
            value = _value(session, field, spec, payload[name])
        except ValidationError as problem:
            # Every value error already names its field and carries the value,
            # so a row-level report needs nothing this loop has to invent.
            problems.append(
                {
                    "field": name,
                    "message": problem.message,
                    "details": dict(problem.details),
                }
            )
            continue
        if value is None and spec.required:
            problems.append(
                {
                    "field": name,
                    "message": f"{field.title} cannot be empty.",
                    "details": {"field": name},
                }
            )
            continue
        values[name] = value

    if not values and not problems:
        problems.append(
            {
                "field": "",
                "message": "Nothing to write.",
                "details": {"editable": sorted(writable)},
            }
        )
    return values, problems


def _coerced(
    session, resource: Resource, payload: dict[str, Any], *, creating: bool
) -> dict[str, Any]:
    """Every writable field the payload names, converted and checked.

    Unknown keys are an error rather than a silent omission: a form that posts
    `assignee` where the field is `assignee_id` otherwise appears to save and
    changes nothing, which is the most expensive kind of bug to report.

    The first problem wins, because that is what a form wants — see `coerce`.
    """
    values, problems = coerce(session, resource, payload, creating=creating)
    if problems:
        first = problems[0]
        raise ValidationError(first["message"], details=first["details"])
    return values


def _value(session, field: Field, spec: Writable, raw: Any) -> Any:
    """One payload value, as the column will store it."""
    if raw is None or (isinstance(raw, str) and not raw.strip()):
        return None

    if field.kind == "enum":
        return _enum(field, raw)
    if field.kind == "bool":
        return _bool(field, raw)
    if field.kind == "number":
        return _number(field, spec, raw)
    if field.kind == "datetime":
        return _moment(field, raw)
    if field.kind == "uuid":
        return _reference(session, field, raw)
    if field.kind == "json":
        return _document(field, raw)
    return _text(field, raw)


def _enum(field: Field, raw: Any) -> str:
    value = str(raw).strip().upper()
    if field.choices and value not in field.choices:
        raise ValidationError(
            f"{value} is not a {field.title.lower()} this record can have.",
            details={"field": field.name, "value": value, "allowed": list(field.choices)},
        )
    return value


def _bool(field: Field, raw: Any) -> bool:
    if isinstance(raw, bool):
        return raw
    value = str(raw).strip().lower()
    if value in ("true", "1", "yes"):
        return True
    if value in ("false", "0", "no"):
        return False
    raise ValidationError(
        f"{field.title} must be true or false.", details={"field": field.name, "value": raw}
    )


def _number(field: Field, spec: Writable, raw: Any) -> Any:
    try:
        number = Decimal(str(raw).strip())
    except (InvalidOperation, ValueError) as exc:
        raise ValidationError(
            f"{field.title} must be a number.", details={"field": field.name, "value": raw}
        ) from exc

    if spec.minimum is not None and number < Decimal(str(spec.minimum)):
        raise _out_of_range(field, spec, number)
    if spec.maximum is not None and number > Decimal(str(spec.maximum)):
        raise _out_of_range(field, spec, number)

    # An `Integer` column given 3.7 stores 3 without complaint in some drivers
    # and raises in others; rounding here means one answer everywhere.
    column_type = getattr(field.column, "type", None)
    if isinstance(column_type, Integer):
        return int(number.to_integral_value())
    if isinstance(column_type, Numeric):
        return number
    return float(number)


def _out_of_range(field: Field, spec: Writable, value: Decimal) -> ValidationError:
    low = "" if spec.minimum is None else f"{spec.minimum:g}"
    high = "" if spec.maximum is None else f"{spec.maximum:g}"
    span = f"between {low} and {high}" if low and high else (f"at least {low}" if low else f"at most {high}")
    return ValidationError(
        f"{field.title} must be {span}.",
        details={"field": field.name, "value": float(value),
                 "minimum": spec.minimum, "maximum": spec.maximum},
    )


def _moment(field: Field, raw: Any) -> datetime:
    """An ISO date or timestamp, stored as an aware UTC moment.

    A bare date is accepted because a date input sends one, and midnight UTC
    is what "due on the 14th" means to a column that has to sort.
    """
    text = str(raw).strip().replace("Z", "+00:00")
    try:
        parsed: date | datetime = datetime.fromisoformat(text)
    except ValueError:
        try:
            parsed = date.fromisoformat(text)
        except ValueError as exc:
            raise ValidationError(
                f"{field.title} must be a date or timestamp.",
                details={"field": field.name, "value": raw},
            ) from exc
    if not isinstance(parsed, datetime):
        parsed = datetime.combine(parsed, datetime.min.time())
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)


#: A checklist longer than this is a project, not a card (§18).
MAX_ITEMS = 50
#: One to-do line. Longer than this and it belongs in the description.
MAX_ITEM_CHARS = 200


def _document(field: Field, raw: Any) -> Any:
    """A JSON field, validated as the shape the page actually renders.

    Only lists of `{text, done}` today, because the one declared JSON writable
    is a checklist. Storing whatever arrives would make the column a place any
    client could put anything — which is how a JSONB column becomes a second,
    undocumented schema.
    """
    if not isinstance(raw, (list, tuple)):
        raise ValidationError(
            f"{field.title} must be a list of items.", details={"field": field.name}
        )
    if len(raw) > MAX_ITEMS:
        raise ValidationError(
            f"{field.title} holds at most {MAX_ITEMS} items.",
            details={"field": field.name, "count": len(raw), "maximum": MAX_ITEMS},
        )

    items = []
    for entry in raw:
        if not isinstance(entry, dict):
            raise ValidationError(
                f"Each {field.title.lower()} item must be an object.",
                details={"field": field.name},
            )
        text = str(entry.get("text") or "").strip()
        if not text:
            raise ValidationError(
                f"A {field.title.lower()} item needs text.", details={"field": field.name}
            )
        if len(text) > MAX_ITEM_CHARS:
            raise ValidationError(
                f"A {field.title.lower()} item is at most {MAX_ITEM_CHARS} characters.",
                details={"field": field.name, "length": len(text)},
            )
        items.append({"text": text, "done": bool(entry.get("done", False))})
    return items


def _reference(session, field: Field, raw: Any) -> UUID:
    """A foreign key, checked against the table the schema says it points at."""
    value = parse_uuid(raw, field=field.name)
    target = _target_of(field)
    if target is None:  # pragma: no cover - a declared uuid that is not an FK
        return value

    model, column = target
    statement = select(func.count()).select_from(model).where(column == value)
    deleted = getattr(model, "deleted_at", None)
    if deleted is not None:
        statement = statement.where(deleted.is_(None))
    if not session.scalar(statement):
        raise NotFoundError(
            f"No {field.title.removesuffix(' ID').lower()} with that id.",
            details={"field": field.name, "value": str(value)},
        )
    return value


def _target_of(field: Field) -> tuple[Any, Any] | None:
    """The (model, primary key column) a foreign-key field points at.

    Read off the column's own `ForeignKey` rather than a mapping kept here: a
    second description of the schema is wrong the first time anybody migrates.
    """
    from src.models.base import Base

    keys = getattr(field.column, "foreign_keys", set()) or set()
    for key in keys:
        table = key.column.table
        for mapper in Base.registry.mappers:
            if mapper.local_table is not None and mapper.local_table.name == table.name:
                return mapper.class_, getattr(mapper.class_, key.column.name)
    return None


def _text(field: Field, raw: Any) -> str:
    value = str(raw).strip()
    column_type = getattr(field.column, "type", None)
    limit = getattr(column_type, "length", None) if isinstance(column_type, (String, Text)) else None
    if limit and len(value) > limit:
        raise ValidationError(
            f"{field.title} is longer than {limit} characters.",
            details={"field": field.name, "length": len(value), "maximum": limit},
        )
    return value


# ── identifiers, races and audit state ───────────────────────────────────


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
    # Timestamps round-trip through JSON at microsecond precision, so compare
    # to the second: a difference smaller than that is the same version.
    if abs((current - seen).total_seconds()) > 1:
        raise ConflictError(
            f"Somebody else changed this {_singular(resource)} while you were editing it.",
            details={
                "resource_type": resource.key,
                "id": str(row.id),
                "expected": seen.isoformat(),
                "current": current.isoformat(),
            },
        )


def _load(session, resource: Resource, record_id: Any):
    from src.services.records import _lookup

    row = session.scalars(_lookup(resource, parse_uuid(record_id, field="record_id"))).first()
    if row is None:
        raise NotFoundError(
            f"That {_singular(resource)} does not exist.",
            details={"resource_type": resource.key, "id": str(record_id)},
        )
    return row


def _state(resource: Resource, row: Any, only: dict[str, Any] | None = None) -> dict[str, Any]:
    """The audit diff's view of a record: the writable fields, serialised."""
    from src.services.explorer import _json_value

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
