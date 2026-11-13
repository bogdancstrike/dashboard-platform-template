"""Executing an import: writing every valid row."""

from __future__ import annotations

from typing import Any

from src.core import audit, background, vocabulary
from src.core.clock import now
from src.core.db import session_scope
from src.core.errors import ConflictError, ValidationError
from src.models.platform import ImportRun
from src.services.records import explorer
from src.services.records import writes as record_writes
from src.services.transfer.imports.run_view import (
    _serialise,
    _unmapped_required,
    can_execute,
)
from src.services.transfer.imports.runs import _row_for
from src.services.transfer.imports.targets import PERMISSION


def execute(session, ident: Any, *, principal) -> dict[str, Any]:
    """Write the valid rows. All of them or none of them.

    Off the request, as an export is (§30): five thousand inserts and their
    audit entries are not a request a browser holds open. The row goes RUNNING
    immediately and the page follows it, which is honest — and a small import
    is finished before the page has redrawn.
    """
    principal.require(PERMISSION)
    row = _row_for(session, ident, principal=principal)

    if not can_execute(row):
        raise ConflictError(
            _why_not(row),
            details={
                "status": row.status,
                "valid_rows": row.valid_rows,
                "unmapped_required": _unmapped_required(row),
            },
        )

    row.status = "RUNNING"
    row.step = "EXECUTE"
    session.commit()

    run_id = row.id
    # The principal is captured, not looked up again: the records are created
    # *as* the person who asked, and their permissions were checked here.
    mechanism = background.spawn(
        lambda: run(run_id, principal), name=f"import:{row.reference}"
    )
    session.refresh(row)
    return {**_serialise(row, detail=True), "ran_as": mechanism}


def _why_not(row: ImportRun) -> str:
    """Why this import cannot be run, in the words the page shows."""
    if row.status == "COMPLETED":
        return f"{row.reference} has already been imported."
    if row.status == "RUNNING":
        return f"{row.reference} is being imported now."
    if row.status not in vocabulary.IMPORT_OPEN:
        return f"{row.reference} was {row.status.lower()} and cannot be run."
    missing = _unmapped_required(row)
    if missing:
        return (
            "Every required field needs a column before this can run: "
            + ", ".join(missing)
            + "."
        )
    if row.valid_rows <= 0:
        return "No row in this file is valid, so there is nothing to import."
    return f"{row.reference} has not been validated yet."


def run(run_id: Any, principal) -> None:
    """Create the records. One transaction, its own session, its own failures.

    All-or-nothing by construction: everything happens inside one
    `session_scope`, so a failure on row 4,812 rolls back the 4,811 before it.
    That is the guarantee §29 asks for, and the reason it matters is not
    tidiness — a spreadsheet loaded twice is what happens when nobody can tell
    how much of it landed the first time.
    """
    try:
        with session_scope() as session:
            row = session.get(ImportRun, run_id)
            if row is None or row.status != "RUNNING":
                return
            resource = explorer.resources().get(row.target_entity)
            if resource is None:
                raise ValidationError(
                    f"{row.target_entity} is no longer a dataset this platform has.",
                    details={"target_entity": row.target_entity},
                )

            mapping = row.column_mapping or {}
            bad_lines = {problem.get("line") for problem in (row.errors or [])}
            payloads = []
            for index, source in enumerate(row.staged_rows or []):
                line = index + 2
                if line in bad_lines:
                    continue
                payload = {field: source.get(column, "") for column, field in mapping.items()}
                if not any(str(value).strip() for value in payload.values()):
                    continue
                payloads.append(payload)

            created = record_writes.create_many(
                session, resource.key, payloads, principal=principal
            )

            row.status = "COMPLETED"
            row.step = "DONE"
            row.imported_rows = len(created)
            row.completed_at = now()
            # The staged file is cleared once it has been used: it is a copy of
            # somebody's spreadsheet, and keeping it after the records exist
            # would be holding the data twice for no reason.
            row.staged_rows = None
            audit.record(
                session,
                action="import.execute",
                resource_type="import",
                resource_id=row.id,
                resource_label=row.reference,
                principal=principal,
                after={
                    "into": resource.key,
                    "created": len(created),
                    "skipped": row.skipped_rows,
                    "invalid": row.invalid_rows,
                },
                message=f"imported {len(created)} {resource.label.lower()} from {row.filename}",
            )
    except Exception as exc:  # noqa: BLE001 - the run records every outcome
        with session_scope() as session:
            row = session.get(ImportRun, run_id)
            if row is None:
                raise
            row.status = "FAILED"
            row.step = "PREVIEW"
            row.completed_at = now()
            row.imported_rows = 0
            # Recorded as a problem about the whole file rather than a row: the
            # transaction rolled back, so no row is any more at fault than the
            # rest.
            row.errors = [
                *(row.errors or []),
                {
                    "line": 0,
                    "column": "",
                    "value": "",
                    "message": f"Nothing was imported. {type(exc).__name__}: {exc}"[:400],
                },
            ]
        return
