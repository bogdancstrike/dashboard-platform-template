"""CSV, JSON-lines and XLSX writers."""

from __future__ import annotations

import csv
import io
import json
from collections.abc import Iterable, Iterator
from typing import Any

from src.core.errors import ValidationError
from src.core.export.cells import Column, _row_values, defuse


def csv_lines(rows: Iterable[Any], columns: list[Column]) -> Iterator[str]:
    """A CSV, one chunk at a time, starting with a BOM.

    The BOM is not decoration: Excel on Windows reads a UTF-8 CSV without one
    as the local codepage, and every accented name in the file comes out
    mangled. It is the single most reported "your export is broken" bug.
    """
    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\n")

    def flush() -> str:
        text = buffer.getvalue()
        buffer.seek(0)
        buffer.truncate(0)
        return text

    yield "﻿"
    writer.writerow([column.title for column in columns])
    yield flush()

    for row in rows:
        writer.writerow([defuse(value) for value in _row_values(row, columns)])
        yield flush()


def json_lines(rows: Iterable[Any], columns: list[Column]) -> Iterator[str]:
    """A JSON array, streamed element by element.

    A real array rather than newline-delimited JSON, because the caller asked
    for `.json` and every tool that reads one expects to be able to parse the
    whole file. Built by hand rather than by `json.dumps(list(rows))` for the
    same reason the CSV is: the list is the thing we are refusing to hold.
    """
    yield "["
    first = True
    for row in rows:
        values = _row_values(row, columns, blank_none=False)
        record = {column.name: value for column, value in zip(columns, values, strict=True)}
        yield ("" if first else ",") + json.dumps(record, default=str, ensure_ascii=False)
        first = False
    yield "]"


def xlsx_bytes(rows: Iterable[Any], columns: list[Column], *, sheet: str = "Export") -> bytes:
    """A workbook, in one piece because a zip container cannot be streamed.

    `write_only` keeps openpyxl from building a cell object graph for the whole
    sheet, which is what makes the difference between a bounded amount of
    memory and a copy of the table.
    """
    try:
        from openpyxl import Workbook
        from openpyxl.cell import WriteOnlyCell
        from openpyxl.styles import Font
    except ImportError as exc:  # pragma: no cover - dependency is declared
        raise ValidationError(
            "XLSX export is unavailable on this deployment; use CSV or JSON.",
        ) from exc

    workbook = Workbook(write_only=True)
    worksheet = workbook.create_sheet(title=sheet[:31] or "Export")

    header = []
    for column in columns:
        heading = WriteOnlyCell(worksheet, value=column.title)
        heading.font = Font(bold=True)
        header.append(heading)
    worksheet.append(header)

    for row in rows:
        worksheet.append([defuse(value) for value in _row_values(row, columns)])

    stream = io.BytesIO()
    workbook.save(stream)
    return stream.getvalue()
