"""What an uploaded sheet is, and sniffing its dialect."""

from __future__ import annotations

import csv
import re
from dataclasses import dataclass
from dataclasses import field as dataclass_field
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


def name_of(delimiter: str) -> str:
    """What to call a separator in a sentence a person reads."""
    return {",": "comma", ";": "semicolon", "\t": "tab", "|": "pipe"}.get(
        delimiter, repr(delimiter)
    )


def _first_line(text: str) -> str:
    for line in text.splitlines():
        if line.strip():
            return line
    return ""
