"""Two or more records side by side, with the differences marked (§47).

The question this answers is "what is actually different about these", and it
is asked most often about records somebody suspects are the same thing twice —
two customers with one email address, two orders for the same basket, two
tickets raised about one fault. A reader can answer it by opening two tabs and
looking from one to the other, which is how the differences get missed.

Three decisions carry this module.

**One row per declared field, not one per field that happens to differ.** The
fields that are the *same* are the evidence that two records are the same
thing, so they are returned too and the page hides them on request. A view that
only ever shows differences cannot answer "are these duplicates".

**`differs` is computed on the serialised value**, the same value the page
draws. Comparing the ORM attributes would let two records look identical on
screen and be marked different — a `Decimal("10.00")` and a `Decimal("10.0")`
are not equal in Python and are the same money.

**The cap is small and it is about reading, not about SQL.** Five columns of
thirty fields is already a page somebody scrolls sideways; ten is a table
nobody can compare anything in. The refusal names the cap and the count so the
reader can narrow rather than guess.
"""

from __future__ import annotations

from typing import Any

from src.core.errors import NotFoundError, ValidationError
from src.core.pagination import parse_uuid
from src.services.explorer import resource_for
from src.services.records import _lookup

#: The most records one comparison may hold.
#:
#: Not a technical limit. Five columns of thirty fields is a page somebody
#: already scrolls sideways, and the whole value of the view is that two
#: values can be read against each other without moving the eye far.
MAX_RECORDS = 5

#: The fewest. One record compared with nothing is the detail page, and
#: answering it here would be a second, worse detail page.
MIN_RECORDS = 2


def compare(session, resource_type: Any, raw_ids: Any, *, principal) -> dict[str, Any]:
    """The records named, field by field, with the differences marked."""
    resource = resource_for(resource_type, principal=principal)
    identifiers = _identifiers(raw_ids)

    rows = session.scalars(_lookup(resource, identifiers)).unique().all()
    found = {row.id: row for row in rows}
    missing = [str(one) for one in identifiers if one not in found]
    if missing:
        # Named, because "one of these no longer exists" is the answer for a
        # comparison started from a list somebody has since changed.
        raise NotFoundError(
            f"{len(missing)} of those {resource.label.lower()} no longer exist.",
            details={"resource_type": resource.key, "missing": missing},
        )

    # In the order asked for, so the reader's own left-to-right is preserved:
    # a comparison whose columns are in database order is one they have to
    # re-find their place in.
    ordered = [found[one] for one in identifiers]

    from src.services.explorer import _json_value

    records = [
        {
            "id": str(row.id),
            "title": resource.label_for(row),
            "path": f"{resource.path}/{row.id}",
            "status": getattr(row, resource.status_field, None),
        }
        for row in ordered
    ]

    rows_out: list[dict[str, Any]] = []
    for spec in resource.fields.fields:
        if spec.name == "id":
            # The one field guaranteed to differ and guaranteed not to matter.
            continue
        values = [_json_value(getattr(row, spec.name, None)) for row in ordered]
        rows_out.append(
            {
                "name": spec.name,
                "label": spec.title,
                "kind": spec.kind,
                "values": values,
                # Compared on the *serialised* value, which is what the page
                # draws: `Decimal("10.00")` and `Decimal("10.0")` are not equal
                # in Python and are the same money.
                "differs": len({_comparable(value) for value in values}) > 1,
            }
        )

    return {
        "resource_type": resource.key,
        "resource_label": resource.label,
        "path": resource.path,
        "records": records,
        "fields": rows_out,
        "differing": sum(1 for row in rows_out if row["differs"]),
        "same": sum(1 for row in rows_out if not row["differs"]),
        "limit": MAX_RECORDS,
    }


def _identifiers(raw: Any) -> list:
    """The ids asked for: parsed, de-duplicated, order kept, count checked."""
    if isinstance(raw, str):
        parts = [piece.strip() for piece in raw.split(",") if piece.strip()]
    elif isinstance(raw, (list, tuple)):
        parts = [str(piece).strip() for piece in raw if str(piece).strip()]
    else:
        parts = []

    seen: list = []
    for part in parts:
        identifier = parse_uuid(part, field="ids")
        # De-duplicated rather than refused: a selection that names one record
        # twice is a client's mistake, and comparing a record with itself would
        # produce a table where nothing differs and nothing is wrong.
        if identifier not in seen:
            seen.append(identifier)

    if len(seen) < MIN_RECORDS:
        raise ValidationError(
            f"A comparison needs at least {MIN_RECORDS} records.",
            details={"ids": len(seen), "minimum": MIN_RECORDS},
        )
    if len(seen) > MAX_RECORDS:
        raise ValidationError(
            f"{len(seen)} records is more than {MAX_RECORDS} can be read side by side. "
            "Compare fewer.",
            details={"ids": len(seen), "limit": MAX_RECORDS},
        )
    return seen


def _comparable(value: Any) -> Any:
    """A value in a form two of them can be compared and hashed in.

    Lists and objects arrive from JSONB columns and are not hashable; their
    serialised form is, and it is also what the page shows — so two records
    whose tags read the same are the same here.
    """
    if isinstance(value, (list, dict)):
        import json

        return json.dumps(value, sort_keys=True, default=str)
    return value
