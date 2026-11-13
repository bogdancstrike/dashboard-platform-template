"""Creating and updating records."""

from __future__ import annotations

from typing import Any

from src.core import audit
from src.core.errors import ValidationError
from src.services.records.detail import detail
from src.services.records.explorer import resource_for
from src.services.records.writes.apply import _after_write, _automations, apply_values
from src.services.records.writes.coercion import _coerced, _object
from src.services.records.writes.events import (
    CONCURRENCY_KEY,
    CREATE_PERMISSION,
    UPDATE_PERMISSION,
    update_requested,
)
from src.services.records.writes.identity import (
    _insert,
    _load,
    _refuse_a_lost_race,
    _state,
)


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
    _after_write(session, resource, row, set(values))

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
    _automations(session, resource, row, set(values), created=True, principal=principal)
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
    # With a version to check, the row is locked first: two saves of the same
    # version used to both read the old `updated_at`, both pass, and the
    # second silently overwrote the first (tests/chaos/test_api_edges.py).
    row = _load(session, resource, record_id, lock=bool(body.get(CONCURRENCY_KEY)))
    _refuse_a_lost_race(resource, row, body.get(CONCURRENCY_KEY))

    values = _coerced(session, resource, body, creating=False)
    # A rule may say this edit needs a second pair of eyes: it is then held as
    # a change request and applied only when approved (Time & decisions).
    held = update_requested.first(session, resource, row, values, body, principal=principal)
    if held is not None:
        return {**detail(session, resource.key, row.id, principal=principal), "pending_approval": held}
    apply_values(session, resource, row, values, principal=principal)
    return detail(session, resource.key, row.id, principal=principal)
