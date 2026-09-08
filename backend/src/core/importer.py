"""Reading a spreadsheet somebody exported from something else (§29).

The half of an import that knows nothing about what is being imported: how to
find the delimiter, how to read the rows, and how to guess which column means
which field. `services/imports` supplies the meaning; this supplies the
mechanics, and keeping them apart is what lets the validation be the *same*
validation a form uses rather than a second implementation of it.

Five things this file exists to get right, each of them a way a hand-written
CSV import goes wrong.

**The delimiter is detected, and the detection is explained.** Half the
spreadsheets in Europe are semicolon-separated because Excel follows the
locale, and a parser that assumes a comma reads such a file as one column
whose name is the whole header line. `sniff` picks the separator that yields
the most consistent row width, reports what it found and why, and the wizard
shows it so somebody can override a wrong guess rather than wondering why
their file has one column.

**A BOM is not part of the first column's name.** Excel writes UTF-8 with a
byte-order mark, so the first header comes back as `\\ufeffcode` and matches
nothing — which presents as "the first column cannot be mapped" on every file
a Windows user produces. `core/export` writes one deliberately for the same
reason; this strips it.

**A blank line is not a row of empty fields.** Trailing newlines are
universal, and a file with one produces a final row of `None`s that fails
validation on every required field. A row that is entirely empty is dropped
before anybody is told about it.

**A ragged row is a problem about the row, not about the file.** Real exports
have them — an unescaped comma inside a description is the usual cause — and
aborting the whole import means nobody ever finds out which line it was. Short
rows are padded, long rows are reported, and the import carries on.

**Nothing here is unbounded.** A CSV arrives as text in a request because the
API has to parse it anyway — routing it through object storage first would
move the bytes twice through the same worker — so the size and row count are
capped before a single row is staged, and the refusal says the number.
"""

from __future__ import annotations

import csv
import io
import re
from dataclasses import dataclass, field as dataclass_field
from typing import Any

from src.core.errors import ValidationError

#: Separators worth trying, in the order they are worth trying them.
#:
#: Comma first because it is the format's name; semicolon second because
#: Excel writes it for most of Europe and it is the commonest reason a
#: hand-rolled import reads a file as a single column. Tab and pipe because
#: they are what somebody reaches for when their data contains both.
DELIMITERS = (",", ";", "\t", "|")

#: The largest file this will parse, in bytes.
#:
#: A CSV arrives as text in the request body, so this bounds the request. Ten
#: megabytes of CSV is comfortably more than the row cap below allows and small
#: enough that a worker holding one is not a problem.
MAX_BYTES = 10 * 1024 * 1024

#: The most rows one import may carry.
#:
#: Bounded because every row is staged in JSONB between the wizard's steps and
#: read back on each one: a hundred thousand staged rows is a JSONB column
#: nobody should be asking PostgreSQL to rewrite on every mapping change. A
#: larger file is a job for the export/import *pipeline* somebody builds on
#: this, and the refusal says so rather than timing out.
MAX_ROWS = 5_000

#: How many rows the wizard previews. The rest are validated and counted.
PREVIEW_ROWS = 50

#: Characters that carry no meaning in a column name, for matching purposes.
#: `Account Manager`, `account_manager` and `ACCOUNT-MANAGER` are one name.
_NOISE = re.compile(r"[^a-z0-9]+")


@dataclass(frozen=True, slots=True)
class Dialect:
    """What the file turned out to be, and why we think so."""

    delimiter: str
    #: How many columns the header line has under this delimiter.
    columns: int
    #: Whether every row agreed with the header about the column count.
    consistent: bool
    #: A sentence the wizard shows, so a wrong guess is visible rather than
    #: mysterious.
    note: str

    @property
    def label(self) -> str:
        return {",": "comma", ";": "semicolon", "\t": "tab", "|": "pipe"}.get(
            self.delimiter, self.delimiter
        )


@dataclass(frozen=True, slots=True)
class Column:
    """One column of the file as found, with a sample so a person can tell
    which is which. Two columns called `name` are distinguished by what is in
    them, not by their position."""

    index: int
    name: str
    samples: tuple[str, ...] = ()

    def as_dict(self) -> dict[str, Any]:
        return {"index": self.index, "name": self.name, "samples": list(self.samples)}


@dataclass(slots=True)
class Sheet:
    """A parsed file: what its columns are, and what its rows hold."""

    dialect: Dialect
    columns: tuple[Column, ...]
    rows: list[dict[str, str]] = dataclass_field(default_factory=list)
    #: Lines that could not be read as rows, by line number.
    ragged: list[dict[str, Any]] = dataclass_field(default_factory=list)
    #: Lines dropped for being entirely empty. Counted, never reported: a
    #: trailing newline is not something anybody needs to be told about.
    blank: int = 0

    @property
    def total(self) -> int:
        return len(self.rows)


def sniff(text: str) -> Dialect:
    """Which separator this file uses.

    Chosen by consistency rather than by frequency: a description containing
    six commas makes the comma the most *common* character on the line and the
    wrong answer. The separator that gives every line the same number of
    fields — and more than one field — is the one that is actually structuring
    the file.
    """
    header = _first_line(text)
    if not header:
        raise ValidationError("That file has no rows in it.")

    lines = [line for line in text.splitlines()[:20] if line.strip()]
    best: Dialect | None = None

    for delimiter in DELIMITERS:
        widths = [len(next(csv.reader([line], delimiter=delimiter), [])) for line in lines]
        if not widths or widths[0] < 2:
            continue
        consistent = len(set(widths)) == 1
        candidate = Dialect(
            delimiter=delimiter,
            columns=widths[0],
            consistent=consistent,
            note=(
                f"Read as {name_of(delimiter)}-separated, {widths[0]} columns."
                if consistent
                else f"Read as {name_of(delimiter)}-separated, but the rows disagree "
                f"about how many columns there are."
            ),
        )
        # A consistent read always beats an inconsistent one; between two
        # consistent reads, more columns means the separator is doing more of
        # the structuring.
        if best is None or (candidate.consistent, candidate.columns) > (
            best.consistent,
            best.columns,
        ):
            best = candidate

    if best is None:
        # One column under every separator. Legitimate — a single-column file
        # is a list — and worth saying rather than guessing at.
        return Dialect(
            delimiter=",",
            columns=1,
            consistent=True,
            note="Only one column found. If this file uses a separator, it is not one "
            "this reads: " + ", ".join(name_of(item) for item in DELIMITERS) + ".",
        )
    return best


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


def name_of(delimiter: str) -> str:
    """What to call a separator in a sentence a person reads."""
    return {",": "comma", ";": "semicolon", "\t": "tab", "|": "pipe"}.get(
        delimiter, repr(delimiter)
    )


def _without_bom(text: str) -> str:
    return text.lstrip("﻿")


def _first_line(text: str) -> str:
    for line in text.splitlines():
        if line.strip():
            return line
    return ""


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
