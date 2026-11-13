"""Starting an import from an uploaded file."""

from __future__ import annotations

from typing import Any

from sqlalchemy import func, select

from src.core import audit, importer, vocabulary
from src.core.errors import ConflictError, ValidationError
from src.core.naming import identifier, sequence_of
from src.core.query import count_of
from src.models.platform import ImportRun
from src.services.transfer.imports.run_view import _serialise
from src.services.transfer.imports.runs import _mine
from src.services.transfer.imports.targets import (
    MAX_OPEN_PER_PERSON,
    PERMISSION,
    REFERENCE_PREFIX,
    _resource_for,
)


def begin(session, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    """Accept a file and read it. The first step.

    The CSV arrives as text in the request because the API has to parse it
    anyway: routing it through object storage and fetching it back would move
    the same bytes through the same worker twice for no benefit. Bounded by
    `importer.MAX_BYTES` and refused before anything is stored.
    """
    principal.require(PERMISSION)
    body = payload if isinstance(payload, dict) else {}

    resource = _resource_for(body.get("target_entity"), principal=principal)
    filename = str(body.get("filename") or "").strip() or "import.csv"
    content = body.get("content")
    if not isinstance(content, str) or not content.strip():
        raise ValidationError(
            "There is nothing in that file.", details={"filename": filename}
        )

    open_runs = count_of(
        session, _mine(principal).where(ImportRun.status.in_(vocabulary.IMPORT_OPEN))
    )
    if open_runs >= MAX_OPEN_PER_PERSON:
        raise ConflictError(
            f"You have {open_runs} imports open, which is the limit. Finish one or "
            "discard it first.",
            details={"open": open_runs, "maximum": MAX_OPEN_PER_PERSON},
        )

    sheet = importer.read(content, delimiter=str(body.get("delimiter") or ""))
    mapping = importer.suggest(
        sheet.columns,
        {
            name: resource.fields.by_name[name].title
            for name in resource.writable
        },
    )

    row = ImportRun(
        reference=_reference(session),
        target_entity=resource.key,
        filename=filename[:255],
        status="DRAFT",
        step="MAPPING",
        delimiter=sheet.dialect.delimiter,
        total_rows=sheet.total,
        detected_columns=[column.as_dict() for column in sheet.columns],
        column_mapping=mapping,
        staged_rows=sheet.rows,
        # The file's own problems, before any field is validated: a line with
        # more values than the header is worth reporting on its own terms.
        errors=[
            {"line": problem["line"], "column": "", "value": "", "message": problem["message"]}
            for problem in sheet.ragged
        ]
        or None,
        created_by_id=principal.user_id,
    )
    session.add(row)
    session.flush()

    audit.record(
        session,
        action="import.begin",
        resource_type="import",
        resource_id=row.id,
        resource_label=row.reference,
        principal=principal,
        # The shape of the file, never its contents: an audit row carrying the
        # rows would be a second copy of the data somebody is importing.
        after={
            "into": resource.key,
            "filename": row.filename,
            "rows": sheet.total,
            "columns": [column.name for column in sheet.columns],
        },
    )
    session.commit()

    # The dialect comes from `_serialise`, not from the sheet in hand: it has
    # to be on *every* read or the page's note disappears at the first
    # refetch, which is exactly what happened.
    return {**_serialise(row, detail=True), "blank_rows": sheet.blank}


def _reference(session) -> str:
    """The next `IMP-000123`, from `MAX(reference)` as `core/naming` prescribes."""
    latest = session.scalar(
        select(func.max(ImportRun.reference)).where(
            ImportRun.reference.like(f"{REFERENCE_PREFIX}-%")
        )
    )
    number = sequence_of(latest, prefix=REFERENCE_PREFIX) + 1
    candidate = identifier(REFERENCE_PREFIX, number, width=6)
    while session.scalar(select(ImportRun.id).where(ImportRun.reference == candidate)):
        number += 1
        candidate = identifier(REFERENCE_PREFIX, number, width=6)
    return candidate
