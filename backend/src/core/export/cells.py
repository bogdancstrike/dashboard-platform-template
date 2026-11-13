"""Export formats and limits, columns, and safe cell values."""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from typing import Any
from uuid import UUID

from src.core.clock import now
from src.core.errors import ValidationError

FORMATS = ("csv", "json", "xlsx")


#: Rows above which an export must become a background job (§23) rather than a
#: request somebody's browser is holding open. Chosen to be comfortably longer
#: than a spreadsheet anybody opens and comfortably shorter than a request that
#: outlives a proxy timeout.
MAX_ROWS = 50_000


#: XLSX has to be finished before the first byte can be sent, so its ceiling is
#: what one worker should be willing to hold, not what a stream can carry.
MAX_XLSX_ROWS = 20_000


#: How many rows to pull from the cursor at a time. Large enough that the
#: round trips do not dominate, small enough that a batch is not the file.
BATCH = 500


#: The characters Excel and LibreOffice treat as the start of a formula.
_FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")


@dataclass(frozen=True, slots=True)
class Column:
    """One column of the file: where to read it, and what to call it."""

    name: str
    label: str = ""

    @property
    def title(self) -> str:
        if self.label:
            return self.label
        spaced = self.name.replace("_", " ")
        return spaced[:1].upper() + spaced[1:]


def parse_format(raw: Any, *, default: str = "csv") -> str:
    value = str(raw or default).strip().lower()
    if value not in FORMATS:
        raise ValidationError(
            f"{value!r} is not an export format; use one of " + ", ".join(FORMATS),
            details={"format": value, "supported": list(FORMATS)},
        )
    return value


def limit_for(fmt: str) -> int:
    return MAX_XLSX_ROWS if fmt == "xlsx" else MAX_ROWS


def filename(stem: str, fmt: str, *, moment: datetime | None = None) -> str:
    """`tickets-2026-09-04-1712.csv` — sortable, and says what it holds.

    A downloads folder with four files called `export.csv` is a downloads
    folder where nobody can tell which one was the filtered one.
    """
    stamp = (moment or now()).strftime("%Y-%m-%d-%H%M")
    safe = "".join(char if char.isalnum() or char in "-_" else "-" for char in stem).strip("-")
    return f"{safe or 'export'}-{stamp}.{fmt}"


def cell(value: Any, *, blank_none: bool = True) -> Any:
    """One Python value as something a cell can hold.

    `blank_none` is what separates the two destinations: a CSV cell has no way
    to say "no value" other than being empty, while JSON has `null` — and a
    consumer parsing the JSON should not have to guess whether `""` meant an
    empty string or a missing one.
    """
    if value is None:
        return "" if blank_none else None
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (dict, list, tuple)):
        return json.dumps(value, default=str, ensure_ascii=False)
    return value


def defuse(value: Any) -> Any:
    """Stop a spreadsheet from executing a cell that came from a text box.

    Only text is at risk, and only at the start of the cell. Numbers are left
    alone: quoting `-3` would turn a number column into a text column, which is
    a different kind of broken export.
    """
    if not isinstance(value, str) or not value:
        return value
    return f"'{value}" if value[0] in _FORMULA_PREFIXES else value


def _row_values(row: Any, columns: list[Column], *, blank_none: bool = True) -> list[Any]:
    """A row — ORM object or mapping — as the cells of one line."""
    read = (lambda name: row.get(name)) if isinstance(row, dict) else (
        lambda name: getattr(row, name, None)
    )
    return [cell(read(column.name), blank_none=blank_none) for column in columns]
