"""Mapping file columns onto fields, and validating the rows against them."""

from __future__ import annotations

from typing import Any

from src.core import vocabulary
from src.core.errors import ConflictError, ValidationError
from src.models.platform import ImportRun
from src.services.records import writes as record_writes
from src.services.transfer.imports.runs import _row_for, entry
from src.services.transfer.imports.targets import PERMISSION, _resource_for


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
