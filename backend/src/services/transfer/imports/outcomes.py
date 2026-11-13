"""Discarding an import, and its error report."""

from __future__ import annotations

from typing import Any

from src.core import audit, vocabulary
from src.core.clock import now
from src.core.errors import ConflictError, NotFoundError
from src.services.transfer.imports.run_view import _serialise
from src.services.transfer.imports.runs import _row_for
from src.services.transfer.imports.targets import PERMISSION


def discard(session, ident: Any, *, principal) -> dict[str, Any]:
    """Abandon an import; on a second ask, remove the record of it too.

    Two presses, which is this platform's rule for the shape — `/mail` bins a
    thread on the first delete and removes it on the second, and `/exports`
    drops a file then its record — and it is two because the acts are
    different sizes. The first removes a *copy of somebody's spreadsheet*,
    which is the part that may need to be gone now. The second removes their
    own note that they tried, which is housekeeping.

    A record kept forever is not the right default here either, and the
    end-to-end suite proved it by being the ratchet: it discards what it
    creates and left thirty-three cancelled runs behind. The history that
    matters survives in the audit trail — `import.begin`, `import.execute`,
    `import.discard`, `import.remove` — where the person who made the run
    cannot edit it.

    Reported as `removed` so a caller knows which of the two happened.
    """
    principal.require(PERMISSION)
    row = _row_for(session, ident, principal=principal)

    if row.status in vocabulary.IMPORT_OPEN:
        row.status = "CANCELLED"
        row.step = "DONE"
        row.staged_rows = None
        row.completed_at = now()
        audit.record(
            session,
            action="import.discard",
            resource_type="import",
            resource_id=row.id,
            resource_label=row.reference,
            principal=principal,
            before={"rows": row.total_rows, "valid": row.valid_rows},
        )
        session.commit()
        return {**_serialise(row, detail=True), "removed": False}

    if row.status == "RUNNING":
        raise ConflictError(
            f"{row.reference} is being imported now. Wait for it to finish.",
            details={"status": row.status},
        )

    # Finished or already abandoned: nothing left to take away but the note.
    audit.record(
        session,
        action="import.remove",
        resource_type="import",
        resource_id=row.id,
        resource_label=row.reference,
        principal=principal,
        # Recorded before the row goes, because after it there is nothing to
        # read these off.
        before={
            "status": row.status,
            "into": row.target_entity,
            "filename": row.filename,
            "imported": row.imported_rows,
        },
    )
    answer = {**_serialise(row, detail=True), "removed": True}
    session.delete(row)
    session.commit()
    return answer


def problems(session, ident: Any, *, principal):
    """Every row-level problem as a file (§29).

    A file rather than a list, because it has to go back to the spreadsheet:
    somebody with two hundred bad rows will fix them in Excel, and a screen
    cannot be sorted, filtered or pasted. Line, column, the value as written,
    and the reason — the four things needed to find and fix one.
    """
    from src.core import export as writer

    principal.require(PERMISSION)
    row = _row_for(session, ident, principal=principal)
    found = row.errors or []
    if not found:
        raise NotFoundError(
            f"{row.reference} has no problems to report.",
            details={"reference": row.reference},
        )

    columns = [
        writer.Column("line", "Line"),
        writer.Column("column", "Column"),
        writer.Column("value", "Value"),
        writer.Column("message", "Problem"),
    ]
    # Read from the row rather than streamed: the problems are already in one
    # JSONB column and bounded by the row cap, so there is nothing to stream.
    return writer.response(
        iter(found), columns, fmt="csv", stem=f"{row.reference}-problems"
    )
