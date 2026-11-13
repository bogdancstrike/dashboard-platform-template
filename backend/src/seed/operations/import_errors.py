"""Seed data for operations: _import_errors, _import_columns, _import_rows."""

from __future__ import annotations

from typing import Any


def _import_columns(rng, resource) -> tuple[list[dict[str, Any]], dict[str, str]]:
    """The columns a seeded file has, and what they map onto.

    Derived from the target's writable fields — headed the way a person would
    write them, with a couple of columns the mapping deliberately ignores,
    because a file that maps perfectly is not what anybody's export looks like.
    """
    writable = sorted(resource.writable)
    chosen = writable[: rng.integer(3, min(6, len(writable)))]

    columns: list[dict[str, Any]] = []
    mapping: dict[str, str] = {}
    for position, name in enumerate(chosen):
        # The label rather than the field name: an export from another system
        # is headed "Due date", which is what makes the mapping step earn its
        # place.
        header = resource.fields.by_name[name].title
        columns.append({"index": position, "name": header, "samples": []})
        mapping[header] = name

    # One column nothing maps onto — every real export has an internal id or a
    # legacy code in it.
    columns.append({"index": len(columns), "name": "legacy_ref", "samples": []})
    return columns, mapping


def _import_rows(rng, columns: list[dict[str, Any]], count: int) -> list[dict[str, str]]:
    """Staged rows for a run somebody is in the middle of.

    Values that read as a spreadsheet's rather than as a database's: this is a
    file, and what makes the wizard's preview worth looking at is that its
    contents look like something somebody typed.
    """
    names = [str(column["name"]) for column in columns]
    return [
        {
            name: (
                f"{name.split()[0].lower()}-{row + 1:04d}"
                if row % 7
                # A deliberate hole every seventh row: the preview's empty
                # cells and the "nothing in any mapped column" case are both
                # states the page has to render.
                else ""
            )
            for name in names
        }
        for row in range(count)
    ]


def _import_errors(rng, mapping: dict[str, str], total: int, invalid: int) -> list[dict[str, Any]] | None:
    """Row-level problems, on columns the file has and fields it maps.

    The old version cited an `email` column on datasets with no email, keyed
    the line as `row`, and carried no value — so the error report the wizard
    downloads would have had three empty columns out of four.
    """
    if not invalid or not mapping:
        return None
    pairs = sorted(mapping.items())
    out: list[dict[str, Any]] = []
    for position in range(min(invalid, 12)):
        column, field = pairs[position % len(pairs)]
        line = min(total + 1, 2 + position * 3)
        out.append(
            {
                "line": line,
                "column": column,
                "field": field,
                "value": f"not-a-{field}",
                "message": f"{column} could not be read as {field}.",
            }
        )
    return out
