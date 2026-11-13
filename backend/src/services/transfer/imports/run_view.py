"""An import run as the API returns it, and whether it may execute."""

from __future__ import annotations

from typing import Any

from src.core import importer
from src.core.clock import iso
from src.services.records import explorer


def _serialise(row, *, detail: bool = False) -> dict[str, Any]:
    """One import as the wizard reads it.

    The staged rows are *not* here unless asked for: a listing carrying five
    thousand rows per item is a listing nobody can load. `entry` includes a
    page of them, which is what a preview needs.
    """
    mapping = row.column_mapping or {}
    errors = row.errors or []
    body = {
        "id": str(row.id),
        "reference": row.reference,
        "filename": row.filename,
        "target_entity": row.target_entity,
        "target_label": _label_of(row.target_entity),
        "status": row.status,
        "step": row.step,
        "delimiter": row.delimiter,
        "total_rows": row.total_rows,
        "valid_rows": row.valid_rows,
        "invalid_rows": row.invalid_rows,
        "skipped_rows": row.skipped_rows,
        "imported_rows": row.imported_rows,
        "detected_columns": list(row.detected_columns or []),
        "column_mapping": dict(mapping),
        # Which declared fields the mapping still leaves unfilled, derived
        # rather than stored: the answer changes when the mapping does, and a
        # stored copy would be wrong the moment somebody remapped a column.
        "unmapped_required": _unmapped_required(row),
        "error_count": len(errors),
        "created_at": iso(row.created_at),
        "completed_at": iso(row.completed_at),
        "can_execute": can_execute(row),
        # Whether letting it go would do anything — which is true of a
        # finished run too, because its record can still be removed. Only a
        # run that is *writing* has nothing safe to take away.
        "can_discard": row.status != "RUNNING",
        # And which of the two presses the next one is, so the page can label
        # the button for what it will actually do.
        "holds_file": bool(row.staged_rows or []),
    }
    if detail:
        body["errors"] = errors[: importer.PREVIEW_ROWS]
        body["dialect"] = _dialect(row)
    return body


def _dialect(row) -> dict[str, Any]:
    """What the file turned out to be, rebuilt on every read.

    Returned by `entry` and not only by `begin`, which is where it was at
    first — and the page's promise to *show* the detected separator lasted
    exactly until the first refetch, after which the note disappeared and a
    reader whose file came back as one column had nothing to go on. The
    delimiter is on the row and consistency is derivable from the structural
    problems, so there is nothing to store.
    """
    structural = [problem for problem in (row.errors or []) if not problem.get("column")]
    consistent = not structural
    columns = len(row.detected_columns or [])
    label = importer.name_of(row.delimiter)
    return {
        "delimiter": row.delimiter,
        "label": label,
        "consistent": consistent,
        "note": (
            f"Read as {label}-separated, {columns} columns."
            if consistent
            else f"Read as {label}-separated, but {len(structural)} "
            + ("line disagrees" if len(structural) == 1 else "lines disagree")
            + " about how many columns there are."
        ),
    }


def _label_of(key: str) -> str:
    """What the target dataset is called, or the key when it is gone.

    A dataset can be removed from the registry while old runs still name it,
    and a page showing a blank "into" column would be worse than one showing
    the raw key.
    """
    resource = explorer.resources().get(key)
    return resource.label if resource else key


def _unmapped_required(row) -> list[str]:
    """Required fields no column is mapped to. Empty means ready to validate."""
    resource = explorer.resources().get(row.target_entity)
    if resource is None:
        return []
    mapped = set((row.column_mapping or {}).values())
    return sorted(
        name for name, spec in resource.writable.items() if spec.required and name not in mapped
    )


def can_execute(row) -> bool:
    """Whether this import may be run.

    Validated, with something to write, nothing required left unmapped, and not
    already run. A pure function of the row so the API, the page and the tests
    read the same rule from one place — a button offering an execute the
    endpoint refuses is worse than no button (§76).
    """
    return (
        row.status == "VALIDATED"
        and row.valid_rows > 0
        and not _unmapped_required(row)
    )
