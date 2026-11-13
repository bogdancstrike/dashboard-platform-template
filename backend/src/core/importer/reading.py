"""Reading a sheet, and suggesting a column mapping."""

from __future__ import annotations

import csv
import io

from src.core.errors import ValidationError
from src.core.importer.sheets import (
    _NOISE,
    DELIMITERS,
    MAX_BYTES,
    MAX_ROWS,
    Column,
    Dialect,
    Sheet,
    name_of,
    sniff,
)


def read(text: str, *, delimiter: str = "") -> Sheet:
    """Parse the whole file, or refuse it with the reason.

    Refused before anything is staged: a file over the cap that was accepted
    and then failed at the execute would have cost somebody the mapping step
    for nothing.
    """
    size = len(text.encode("utf-8"))
    if size > MAX_BYTES:
        raise ValidationError(
            f"That file is {size / 1_048_576:.1f} MB and the limit is "
            f"{MAX_BYTES / 1_048_576:.0f} MB.",
            details={"bytes": size, "maximum": MAX_BYTES},
        )

    dialect = sniff(text) if not delimiter else _dialect_for(text, delimiter)
    reader = csv.reader(io.StringIO(_without_bom(text)), delimiter=dialect.delimiter)

    try:
        header = next(reader)
    except StopIteration as exc:
        raise ValidationError("That file has no rows in it.") from exc

    names = _named(header)
    columns = tuple(Column(index=index, name=name) for index, name in enumerate(names))
    sheet = Sheet(dialect=dialect, columns=columns)
    samples: list[list[str]] = [[] for _ in names]

    for line_number, raw in enumerate(reader, start=2):
        if not any(str(cell).strip() for cell in raw):
            sheet.blank += 1
            continue
        if len(sheet.rows) >= MAX_ROWS:
            raise ValidationError(
                f"That file has more than {MAX_ROWS:,} rows, which is the most one "
                "import may carry. Split it, or load it through a data pipeline.",
                details={"maximum": MAX_ROWS, "line": line_number},
            )
        if len(raw) > len(names):
            # Reported and kept: an unescaped separator inside a description is
            # the usual cause, and the person needs the line number.
            sheet.ragged.append(
                {
                    "line": line_number,
                    "found": len(raw),
                    "expected": len(names),
                    "message": (
                        f"This line has {len(raw)} values where the header has "
                        f"{len(names)}. The extra values were ignored."
                    ),
                }
            )
        cells = [str(value) for value in raw[: len(names)]]
        cells += [""] * (len(names) - len(cells))
        for index, value in enumerate(cells):
            if value.strip() and len(samples[index]) < 3:
                samples[index].append(value.strip()[:80])
        sheet.rows.append(dict(zip(names, cells, strict=True)))

    # Samples are attached after the read, because the first rows are where
    # they come from and a column is only distinguishable once you have some.
    sheet.columns = tuple(
        Column(index=column.index, name=column.name, samples=tuple(samples[column.index]))
        for column in columns
    )
    return sheet


def suggest(columns: tuple[Column, ...], fields: dict[str, str]) -> dict[str, str]:
    """A proposed column → field mapping, for the person to confirm.

    Matched on the *normalised* name, so `Account Manager`, `account_manager`
    and `ACCOUNT-MANAGER` all find `account_manager_id`. A suggestion and not a
    decision: the wizard's mapping step exists because the guess is sometimes
    wrong, and an import that mapped silently would write the wrong column into
    the wrong field with no step at which anybody could notice.

    `fields` is `{field name: field label}` — both are matched, because an
    export from another system is as likely to be headed "Due date" as
    `due_date`.
    """
    by_normal: dict[str, str] = {}
    for name, label in fields.items():
        by_normal.setdefault(_normal(name), name)
        by_normal.setdefault(_normal(label), name)
        # `assignee` for `assignee_id`: a foreign key's column name carries a
        # suffix the file's author had no reason to write.
        if name.endswith("_id"):
            by_normal.setdefault(_normal(name[:-3]), name)
            by_normal.setdefault(_normal(label.removesuffix(" ID")), name)

    mapping: dict[str, str] = {}
    taken: set[str] = set()
    for column in columns:
        target = by_normal.get(_normal(column.name))
        # One field per column and one column per field: two columns mapped to
        # `name` would make the second silently win, which is the kind of thing
        # nobody sees until the records are wrong.
        if target and target not in taken:
            mapping[column.name] = target
            taken.add(target)
    return mapping


def _normal(name: str) -> str:
    return _NOISE.sub("", str(name).strip().lower())


def _without_bom(text: str) -> str:
    return text.lstrip("﻿")


def _named(header: list[str]) -> list[str]:
    """Column names, deduplicated and never empty.

    A file with two columns called `name` is a real file; the second becomes
    `name (2)` so a mapping can address it. An unnamed column becomes
    `Column 3` for the same reason — it still has to be selectable, if only to
    be ignored.
    """
    names: list[str] = []
    seen: dict[str, int] = {}
    for index, raw in enumerate(header):
        name = _without_bom(str(raw)).strip() or f"Column {index + 1}"
        seen[name] = seen.get(name, 0) + 1
        names.append(name if seen[name] == 1 else f"{name} ({seen[name]})")
    return names


def _dialect_for(text: str, delimiter: str) -> Dialect:
    """The dialect for a separator somebody chose, rather than one we guessed."""
    if delimiter not in DELIMITERS:
        raise ValidationError(
            f"{delimiter!r} is not a separator this reads.",
            details={"delimiter": delimiter, "supported": list(DELIMITERS)},
        )
    lines = [line for line in text.splitlines()[:20] if line.strip()]
    widths = [len(next(csv.reader([line], delimiter=delimiter), [])) for line in lines]
    consistent = len(set(widths)) <= 1
    return Dialect(
        delimiter=delimiter,
        columns=widths[0] if widths else 0,
        consistent=consistent,
        note=(
            f"Read as {name_of(delimiter)}-separated, {widths[0] if widths else 0} columns."
            if consistent
            else f"Read as {name_of(delimiter)}-separated, but the rows disagree about "
            "how many columns there are."
        ),
    )
