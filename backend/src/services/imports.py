"""Loading a spreadsheet somebody exported from something else (§29).

The wizard is four steps because the decision has four parts, and a single
form asking all of them at once gets a worse answer to each: **which dataset**,
**which column is which field**, **what is wrong with which rows**, and only
then **do it**. `core/importer` reads the file; this decides what the rows
mean.

Six decisions worth the reader's attention.

**The rules are the form's rules, not the importer's.** A row is validated by
`record_writes.coerce` — the same function `POST /api/records/<type>` calls,
against the same `Writable` declarations an edit form is rendered from. An
importer that validated CSV itself would eventually accept a status a form
refuses, and the first anybody would hear of it is a 500 halfway through an
execute. `coerce` collects every problem on a row rather than the first,
because a wizard that reports one error per round trip is a wizard somebody
goes round four times.

**Nothing is written until the person has seen what is wrong.** The preview is
the point of the whole flow: per-row, per-column, with the line number from the
file so it can be found in the spreadsheet. Then the execute is
all-or-nothing — half an import is the outcome this module exists to prevent,
because a spreadsheet loaded twice is what happens when nobody can tell how
much of it landed the first time.

**Every count is derived and they add up.** `total = valid + invalid +
skipped`, checked in the tests and by `--check`, because the seeded runs
carried `valid = total - invalid` with a separate non-zero `skipped` — three
numbers that could not all be true. A "skipped" row here means one thing:
after mapping, it has nothing in any mapped column. Neither valid nor wrong,
just not data.

**The staged rows are the file, and they are bounded.** They live in JSONB
between steps so a draft can be resumed and a mapping changed without
re-uploading — which is what the wizard is for. `importer.MAX_ROWS` bounds it,
because rewriting a hundred thousand staged rows on every mapping change is
not something to ask of PostgreSQL, and the refusal says the number.

**The execute happens off the request**, through `core/background`, for the
same reason an export does (§30): five thousand inserts and their audit rows
are not a request somebody's browser holds open. Which mechanism ran it is on
the row.

**The error report is a file, because it has to go back to the spreadsheet.**
Somebody with 200 bad rows is going to fix them in Excel, and a list on a
screen cannot be sorted, filtered or pasted. It carries the line number, the
column, the value as written and the reason.

**Letting one go takes two presses**, the same rule `/exports` and `/mail`
use: the first drops the copy of the file, the second removes the record. Two,
because one takes production data out of storage and the other tidies away a
note — and the audit trail keeps the history of both, where the person who
made the run cannot edit it.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import Select, func, select

from src.core import audit, background, importer, vocabulary
from src.core.clock import iso, now
from src.core.db import session_scope
from src.core.errors import ConflictError, NotFoundError, ValidationError
from src.core.naming import identifier, sequence_of
from src.core.pagination import envelope, parse_page, parse_uuid
from src.core.query import Field, FieldSet, apply_filters, apply_sort, count_of, facets_for
from src.models.platform import ImportRun
from src.services import explorer, record_writes

#: Writing records from a file is its own privilege, and a narrow one:
#: ADMINISTRATOR and MANAGER hold it. It is also what `/import` declares in the
#: navigation, and the route guard reads the navigation entry — so the two must
#: agree or the page is reachable by roles that cannot use it.
PERMISSION = "records.import"

#: The prefix an import's human identifier carries — `IMP-000123`.
REFERENCE_PREFIX = "IMP"

#: How many imports one person may have open at once.
#:
#: A draft holds its whole file in JSONB, so this is a bound on rows as much as
#: on rows-of-the-table. Generous enough that nobody meets it by accident.
MAX_OPEN_PER_PERSON = 5


# ── what can be imported ─────────────────────────────────────────────────


def _targets(principal) -> dict[str, Any]:
    """The datasets this person may import into.

    A dataset appears only if it declares an `identity` — how a created record
    is named — because that is exactly the declaration that says the API can
    create one. A picker offering a dataset whose create 400s would be a picker
    wasting somebody's time (§76).
    """
    return {
        key: resource
        for key, resource in explorer.resources().items()
        if resource.identity is not None and principal.can(resource.permission)
    }


def _field_catalogue(resource) -> list[dict[str, Any]]:
    """Which fields a file may be mapped onto, and what each accepts.

    Read from the same `Writable` declarations the edit form is rendered from,
    so a field that becomes writable becomes importable the same day — and one
    that does not is not offered.
    """
    out = []
    for name, spec in sorted(resource.writable.items()):
        field = resource.fields.by_name[name]
        out.append(
            {
                "name": name,
                "label": field.title,
                "kind": field.kind,
                "required": spec.required,
                "choices": list(field.choices),
                "minimum": spec.minimum,
                "maximum": spec.maximum,
                # What a foreign key points at, so the wizard can say "this
                # column must hold a customer's id or reference".
                "references": explorer.references_of(field),
            }
        )
    return out


def catalogue(session, *, principal) -> dict[str, Any]:
    """What can be imported, the limits that apply, and where mine stand."""
    principal.require(PERMISSION)
    targets = _targets(principal)

    tallied = session.execute(
        select(ImportRun.status, func.count(ImportRun.id))
        .where(ImportRun.created_by_id == principal.user_id)
        .group_by(ImportRun.status)
    ).all()
    statuses = {status: int(count) for status, count in tallied}

    return {
        "targets": [
            {
                "key": resource.key,
                "label": resource.label,
                "description": resource.description,
                "fields": _field_catalogue(resource),
                "required": sorted(
                    name for name, spec in resource.writable.items() if spec.required
                ),
            }
            for resource in sorted(targets.values(), key=lambda item: item.label)
        ],
        "delimiters": [
            {"key": delimiter, "label": importer.name_of(delimiter)}
            for delimiter in importer.DELIMITERS
        ],
        "max_rows": importer.MAX_ROWS,
        "max_bytes": importer.MAX_BYTES,
        "preview_rows": importer.PREVIEW_ROWS,
        "open_limit": MAX_OPEN_PER_PERSON,
        "open": sum(statuses.get(status, 0) for status in vocabulary.IMPORT_OPEN),
        "statuses": [{"key": status, "count": statuses[status]} for status in sorted(statuses)],
        "steps": list(vocabulary.IMPORT_STEP),
        "total": sum(statuses.values()),
    }


# ── reading the runs ─────────────────────────────────────────────────────


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


# ── the wizard ───────────────────────────────────────────────────────────


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


def map_columns(session, ident: Any, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    """Set which column is which field, then validate every row.

    Mapping and validating are one call because they are one thought: changing
    a mapping changes which rows are wrong, and a wizard that made somebody
    press Validate afterwards would be adding a step whose answer is already
    known.
    """
    principal.require(PERMISSION)
    row = _row_for(session, ident, principal=principal)
    if row.status not in vocabulary.IMPORT_OPEN:
        raise ConflictError(
            f"{row.reference} has already been {row.status.lower()}; its mapping "
            "cannot change.",
            details={"status": row.status},
        )

    resource = _resource_for(row.target_entity, principal=principal)
    body = payload if isinstance(payload, dict) else {}
    mapping = _checked_mapping(body.get("column_mapping"), row, resource)

    row.column_mapping = mapping
    _validate(session, row, resource)
    row.step = "PREVIEW"
    row.status = "VALIDATED" if row.valid_rows else "DRAFT"
    session.commit()
    return entry(session, row.id, principal=principal)


def _checked_mapping(raw: Any, row: ImportRun, resource) -> dict[str, str]:
    """`{column: field}`, with every name checked against the file and the
    resource.

    Both sides, because both go wrong. A column that is not in the file is a
    stale mapping from before somebody re-uploaded; a field that is not
    writable is a client that has the wrong idea about the dataset. And two
    columns onto one field is the quiet one: the second would silently win, and
    nobody sees it until the records are wrong.
    """
    if not isinstance(raw, dict):
        raise ValidationError("The mapping must be an object of column to field.")

    columns = {str(column.get("name")) for column in (row.detected_columns or [])}
    writable = set(resource.writable)

    unknown_columns = sorted(str(key) for key in raw if str(key) not in columns)
    if unknown_columns:
        raise ValidationError(
            "Those columns are not in the file.",
            details={"columns": unknown_columns, "available": sorted(columns)},
        )

    mapping: dict[str, str] = {}
    used: dict[str, str] = {}
    for column, target in raw.items():
        name = str(target or "").strip()
        if not name:
            # A column mapped to nothing is a column deliberately ignored,
            # which is a normal answer and not an omission.
            continue
        if name not in writable:
            raise ValidationError(
                f"{name} is not a field this dataset accepts.",
                details={"field": name, "editable": sorted(writable)},
            )
        if name in used:
            raise ValidationError(
                f"Two columns are mapped to {name}: {used[name]} and {column}. "
                "One would silently overwrite the other.",
                details={"field": name, "columns": [used[name], str(column)]},
            )
        used[name] = str(column)
        mapping[str(column)] = name
    return mapping


def _validate(session, row: ImportRun, resource) -> None:
    """Check every staged row by the rules a form uses, and count the outcome.

    Sets `errors` and the four counts. Nothing is written to the dataset here —
    that is the whole point of the step.
    """
    mapping = row.column_mapping or {}
    staged = row.staged_rows or []

    # The file's own structural problems survive a re-validation: a ragged line
    # is still ragged whatever the mapping says.
    problems: list[dict[str, Any]] = [
        problem for problem in (row.errors or []) if not problem.get("column")
    ]
    invalid_lines: set[int] = set()
    skipped = 0

    for index, source in enumerate(staged):
        line = index + 2
        payload = {
            field: source.get(column, "") for column, field in mapping.items()
        }
        if not any(str(value).strip() for value in payload.values()):
            # Nothing in any mapped column. Neither data nor an error — and
            # counting it as either is how the numbers stopped adding up.
            skipped += 1
            continue

        _, found = record_writes.coerce(session, resource, payload, creating=True)
        for problem in found:
            invalid_lines.add(line)
            column = next(
                (name for name, target in mapping.items() if target == problem["field"]),
                problem["field"],
            )
            problems.append(
                {
                    "line": line,
                    "column": column,
                    "field": problem["field"],
                    # The value as it was written, so the report can be read
                    # beside the spreadsheet.
                    "value": str(source.get(column, ""))[:200],
                    "message": problem["message"],
                }
            )

    row.errors = problems or None
    row.total_rows = len(staged)
    row.skipped_rows = skipped
    row.invalid_rows = len(invalid_lines)
    # Derived, so the four can never disagree: the seeded runs carried
    # `valid = total - invalid` beside a non-zero `skipped`, which made three
    # of the numbers mutually impossible.
    row.valid_rows = len(staged) - skipped - len(invalid_lines)


def _resource_for(key: Any, *, principal):
    """The target dataset, or a refusal naming what may be imported into."""
    targets = _targets(principal)
    resource = targets.get(str(key or ""))
    if resource is None:
        raise ValidationError(
            "That dataset cannot be imported into.",
            details={"target_entity": str(key or ""), "available": sorted(targets)},
        )
    return resource


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


# ── executing ────────────────────────────────────────────────────────────


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


# ── the error report ─────────────────────────────────────────────────────


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
