"""Applying to rows, and describing the outcome."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from src.core.errors import ApiError, ValidationError
from src.core.pagination import parse_uuid
from src.services.records import writes as writes
from src.services.records.bulk.resolution import MAX_ROWS, Selection, _object
from src.services.records.detail import _lookup
from src.services.records.explorer import Resource, resource_for

#: How many labels the preview shows.
#:
#: Enough to recognise the selection, few enough that the count stays the
#: headline. A preview that lists four hundred titles is a preview nobody
#: reads, which is the same as no preview.
SAMPLE = 5


def _plain(value: Any) -> Any:
    from src.services.records.explorer import _json_value

    return _json_value(value)


def _describes(resource: Resource, selection: Selection, counts: dict[str, int]) -> str:
    """The selection in a sentence, for the confirmation the reader reads."""
    total = counts["total"]
    noun = resource.label.lower() if total != 1 else resource.label.rstrip("s").lower()
    if not selection.by_filter:
        return f"{total} {noun} you selected"
    if counts["by_hand"]:
        return (
            f"{total} {noun} — {counts['by_hand']} you selected "
            f"and {counts['by_filter']} matching the filter"
        )
    return f"{total} {noun} matching the filter"


def _outcome(
    resource: Resource, action: str, applied: int, unchanged: int, failed: list[dict[str, Any]]
) -> str:
    """Both halves in one sentence, because a reader reads the sentence."""
    verb = "deleted" if action == "delete" else "updated"
    noun = resource.label.lower() if applied != 1 else resource.label.rstrip("s").lower()
    parts = [f"{verb.capitalize()} {applied} {noun}"]
    if unchanged:
        parts.append(f"{unchanged} already had those values")
    if failed:
        parts.append(f"{len(failed)} could not be {verb}")
    return "; ".join(parts) + "."


def apply_rows(session, resource_type: Any, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    """Save a grid's pending edits: each row its own changes, each reported on.

    The grid edits many cells across many rows, and "set this field on these
    rows" cannot say that. So `rows` carries `{id, changes, expected_updated_at?}`
    per record and the answer carries a result per row — applied, unchanged, or
    failed with *every* field's problem, so the grid can mark the exact cells.

    The same rules as everywhere else: one permission check up front, the
    form's coercion (`record_writes.coerce`, all problems collected), a lost
    race refused per row, the single-record write (`apply_values`) with its
    audit row, and a savepoint per row so one refusal does not undo the rest.
    """
    resource = resource_for(resource_type, principal=principal)
    principal.require(writes.UPDATE_PERMISSION)
    raw_rows = _object(payload).get("rows")
    if not isinstance(raw_rows, list) or not raw_rows:
        raise ValidationError("rows must be a non-empty list.", details={"rows": "Send {id, changes} per row."})
    if len(raw_rows) > MAX_ROWS:
        raise ValidationError(
            f"That would change {len(raw_rows)} records, and {MAX_ROWS} is the most one save may touch.",
            details={"matched": len(raw_rows), "limit": MAX_ROWS},
        )

    wanted: dict[UUID, dict[str, Any]] = {}
    for index, item in enumerate(raw_rows):
        if not isinstance(item, dict) or not isinstance(item.get("changes"), dict):
            raise ValidationError(f"Row {index + 1} needs an id and a changes object.",
                                  details={"row": index + 1})
        wanted[parse_uuid(item.get("id"), field=f"rows[{index}].id")] = item
    found = {row.id: row for row in session.scalars(_lookup(resource, list(wanted)))}

    results: list[dict[str, Any]] = []
    applied = unchanged = 0
    failed: list[dict[str, Any]] = []
    for identifier, item in wanted.items():
        row = found.get(identifier)
        if row is None:
            entry = {"id": str(identifier), "status": "failed", "title": "", "error": "not_found",
                     "message": "This record no longer exists.", "problems": []}
            results.append(entry)
            failed.append(entry)
            continue
        entry: dict[str, Any] = {"id": str(row.id), "title": resource.label_for(row)}
        values, problems = writes.coerce(session, resource, item["changes"], creating=False)
        if problems:
            entry.update(status="failed", error="validation_failed",
                         message=f"{len(problems)} value{'s' if len(problems) != 1 else ''} refused.",
                         problems=[{"field": p["field"], "message": p["message"]} for p in problems])
            results.append(entry)
            failed.append(entry)
            continue
        nested = session.begin_nested()
        try:
            writes._refuse_a_lost_race(resource, row, item.get("expected_updated_at"))
            moved = writes.apply_values(session, resource, row, values, principal=principal)
            nested.commit()
        except ApiError as error:
            nested.rollback()
            entry.update(status="failed", error=error.code, message=str(error.message), problems=[])
            results.append(entry)
            failed.append(entry)
            continue
        updated = getattr(row, "updated_at", None)
        entry.update(status="applied" if moved else "unchanged", changed=sorted(moved), problems=[],
                     updated_at=updated.isoformat() if updated else None)
        if moved:
            applied += 1
        else:
            unchanged += 1
        results.append(entry)

    return {
        "resource_type": resource.key,
        "action": "update",
        "requested": len(wanted),
        "applied": applied,
        "unchanged": unchanged,
        "failed": failed,
        "results": results,
        "records": [{"id": r["id"], "title": r["title"]} for r in results if r["status"] == "applied"][:SAMPLE],
        "message": _outcome(resource, "update", applied, unchanged, failed),
    }
