"""Import runs as the reader sees them: the list and one run."""

from __future__ import annotations

from typing import Any

from sqlalchemy import Select, select

from src.core import importer, vocabulary
from src.core.errors import NotFoundError
from src.core.pagination import envelope, parse_page, parse_uuid
from src.core.query import (
    Field,
    FieldSet,
    apply_filters,
    apply_sort,
    count_of,
    facets_for,
)
from src.models.platform import ImportRun
from src.services.transfer.imports.run_view import _serialise
from src.services.transfer.imports.targets import PERMISSION


def _fields() -> FieldSet:
    """What an import list can be filtered and sorted by. Deliberately short:
    this is one person's recent uploads, not a dataset."""
    return FieldSet(
        Field("reference", ImportRun.reference, label="Reference", searchable=True),
        Field("filename", ImportRun.filename, label="File", searchable=True),
        Field("target_entity", ImportRun.target_entity, kind="enum", label="Into", facet=True),
        Field("status", ImportRun.status, kind="enum", label="Status", facet=True,
              choices=vocabulary.IMPORT_STATUS),
        Field("created_at", ImportRun.created_at, kind="datetime", label="Started"),
        Field("completed_at", ImportRun.completed_at, kind="datetime", label="Finished"),
    )


def _mine(principal) -> Select:
    """This person's imports.

    An import holds the *contents of a file* in `staged_rows` — names, emails,
    whatever the spreadsheet had in it — so it is no more shareable than an
    export's artefact is. Same rule, same reason (§30).
    """
    return select(ImportRun).where(ImportRun.created_by_id == principal.user_id)


def listing(session, args, *, principal) -> dict[str, Any]:
    """One page of my imports, newest first."""
    principal.require(PERMISSION)
    fields = _fields()
    page = parse_page(args, default_sort="created_at")

    statement = apply_filters(_mine(principal), args, fields)
    total = count_of(session, statement)
    facets = facets_for(session, statement, fields)
    statement = apply_sort(statement, page, fields, default="created_at")
    rows = session.scalars(statement.offset(page.offset).limit(page.page_size)).all()

    return envelope(
        [_serialise(row) for row in rows],
        total,
        page,
        facets=facets,
        fields=fields.describe(),
        columns=["reference", "filename", "target_entity", "status", "created_at"],
    )


def _row_for(session, ident: Any, *, principal) -> ImportRun:
    """One of my imports, or a 404 that does not say whose it was."""
    row = session.get(ImportRun, parse_uuid(ident, field="import id"))
    if row is None or row.created_by_id != principal.user_id:
        raise NotFoundError("That import does not exist.", details={"id": str(ident)})
    return row


def entry(session, ident: Any, *, principal) -> dict[str, Any]:
    """One import, with a page of its rows and its errors — the preview."""
    principal.require(PERMISSION)
    row = _row_for(session, ident, principal=principal)
    body = _serialise(row, detail=True)

    staged = row.staged_rows or []
    mapping = row.column_mapping or {}
    body["preview"] = [
        {
            # The line in the *file*, so a person can find it in the
            # spreadsheet. Row 1 is the header, so the first data row is 2.
            "line": index + 2,
            "source": dict(source),
            "values": {field: source.get(column) for column, field in mapping.items()},
            "problems": [
                problem for problem in (row.errors or []) if problem.get("line") == index + 2
            ],
        }
        for index, source in enumerate(staged[: importer.PREVIEW_ROWS])
    ]
    body["preview_total"] = len(staged)
    return body
