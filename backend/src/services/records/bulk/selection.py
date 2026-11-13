"""Bulk actions: the selection, a preview, and applying it."""

from __future__ import annotations

from typing import Any

from src.core.errors import ApiError, ValidationError
from src.services.records import writes as writes
from src.services.records.bulk.outcomes import (
    SAMPLE,
    _describes,
    _outcome,
    _plain,
    apply_rows,
)
from src.services.records.bulk.resolution import (
    MAX_ROWS,
    Selection,
    _action,
    _changes,
    _object,
    _refusals,
    _rows,
    _uuids,
)
from src.services.records.explorer import resource_for


def parse_selection(payload: dict[str, Any]) -> Selection:
    """Read a selection off a request body, refusing an empty one."""
    body = _object(payload)
    raw = body.get("selection") if isinstance(body.get("selection"), dict) else body
    ids = tuple(_uuids(raw.get("ids"), field="ids"))
    excluded = frozenset(_uuids(raw.get("excluded"), field="excluded"))
    query = raw.get("query") if isinstance(raw.get("query"), dict) else None

    if not ids and query is None:
        # A gesture over nothing is a mistake somewhere upstream, and applying
        # it silently to zero rows would report "0 changed" as a success.
        raise ValidationError(
            "Nothing is selected.",
            details={"selection": "Send ids, a query, or both."},
        )
    return Selection(ids=ids, query=query, excluded=excluded)


def preview(session, resource_type: Any, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    """What this gesture would do, before it does it (§75)."""
    resource = resource_for(resource_type, principal=principal)
    selection = parse_selection(payload)
    action = _action(payload)
    # Validated here so a malformed change is a bad request on the *preview*,
    # which is where the reader still has the form open.
    changes = _changes(session, resource, action, payload)

    rows = _rows(session, resource, selection, principal=principal)
    by_hand = [row for row in rows if row.id in set(selection.ids)]
    counts = {
        "total": len(rows),
        "by_hand": len(by_hand),
        # The rows only the filter chose. Reported separately because the two
        # are trusted differently: ticking a box is knowing what is in it.
        "by_filter": len(rows) - len(by_hand),
    }

    refusals = _refusals(resource, rows, action, changes, principal=principal)
    return {
        "resource_type": resource.key,
        "action": action,
        "changes": {name: _plain(value) for name, value in changes.items()},
        **counts,
        "limit": MAX_ROWS,
        # Over the cap is reported rather than raised: the reader needs the
        # number to know how much to narrow by, and an error body is a worse
        # place to read it than the dialog they are already looking at.
        "over_limit": len(rows) > MAX_ROWS,
        "sample": [
            {"id": str(row.id), "title": resource.label_for(row)} for row in rows[:SAMPLE]
        ],
        "refused": refusals,
        "eligible": len(rows) - sum(reason["count"] for reason in refusals),
        "describes": _describes(resource, selection, counts),
    }


def apply(session, resource_type: Any, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    """Do it, and report both halves of what happened (§43)."""
    if isinstance(payload, dict) and "rows" in payload:
        return apply_rows(session, resource_type, payload, principal=principal)
    resource = resource_for(resource_type, principal=principal)
    selection = parse_selection(payload)
    action = _action(payload)
    changes = _changes(session, resource, action, payload)

    # The permission is required once, before anything is touched. Per row it
    # would be the same answer every time, and a gesture that changed the first
    # forty rows and then discovered it was not allowed is worse than one that
    # never started.
    principal.require(
        writes.DELETE_PERMISSION if action == "delete" else writes.UPDATE_PERMISSION
    )

    rows = _rows(session, resource, selection, principal=principal)
    if len(rows) > MAX_ROWS:
        raise ValidationError(
            f"That would change {len(rows)} records, and {MAX_ROWS} is the most one "
            "action may touch. Narrow the selection.",
            details={"matched": len(rows), "limit": MAX_ROWS},
        )

    applied: list[dict[str, Any]] = []
    unchanged: list[dict[str, Any]] = []
    failed: list[dict[str, Any]] = []

    for row in rows:
        entry = {"id": str(row.id), "title": resource.label_for(row)}
        # A savepoint per row, so one refusal does not undo the rows before it.
        # Without it a single lost race turns forty-nine applied writes into
        # nothing, and the reader is told "1 failed" about a list that did not
        # change at all.
        nested = session.begin_nested()
        try:
            if action == "delete":
                writes.remove_row(session, resource, row, principal=principal)
                applied.append(entry)
            else:
                moved = writes.apply_values(
                    session, resource, row, dict(changes), principal=principal
                )
                (applied if moved else unchanged).append(entry)
            nested.commit()
        except ApiError as error:
            nested.rollback()
            failed.append({**entry, "error": error.code, "message": str(error.message)})

    return {
        "resource_type": resource.key,
        "action": action,
        "requested": len(rows),
        "applied": len(applied),
        # Not a failure and not a change: a row that already had the value.
        # Folding these into "applied" would report a no-op as work done, and
        # folding them into "failed" would report it as a problem.
        "unchanged": len(unchanged),
        "failed": failed,
        "records": applied[:SAMPLE],
        "message": _outcome(resource, action, len(applied), len(unchanged), failed),
    }
