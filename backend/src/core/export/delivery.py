"""Writing an export file, its HTTP response, and streaming rows."""

from __future__ import annotations

import contextlib
from collections.abc import Iterable, Iterator
from typing import Any, BinaryIO

from src.core.export.cells import BATCH, Column, filename, limit_for
from src.core.export.writers import csv_lines, json_lines, xlsx_bytes


def write_to(target: BinaryIO, rows: Iterable[Any], columns: list[Column], *, fmt: str) -> int:
    """Write the whole file into `target` and return how many rows it holds.

    The streamed `response` is for a download somebody is waiting on; this is
    for a background export (§30), which has to have the finished bytes before
    it can hand them to object storage. It takes a file object rather than
    returning bytes for the reason the streaming exists at all: a hundred
    thousand rows should cost a buffer, not a copy of the table. Give it a
    `SpooledTemporaryFile` and memory stays bounded whatever the row count.

    XLSX is still assembled in one piece, because a zip container cannot be
    written incrementally — which is why its ceiling is lower.
    """
    counted = 0

    def counting() -> Iterator[Any]:
        nonlocal counted
        for row in rows:
            counted += 1
            yield row

    if fmt == "xlsx":
        target.write(xlsx_bytes(counting(), columns))
        return counted

    lines = json_lines(counting(), columns) if fmt == "json" else csv_lines(counting(), columns)
    for chunk in lines:
        target.write(chunk.encode("utf-8"))
    return counted


CONTENT_TYPES = {
    "csv": "text/csv; charset=utf-8",
    "json": "application/json; charset=utf-8",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
}


def response(rows: Iterable[Any], columns: list[Column], *, fmt: str, stem: str):
    """The download itself.

    `rows` is expected to be a generator that owns its own database session:
    this returns before a single row has been read, and a session opened by the
    handler would be closed by then. See `stream_rows`.
    """
    from flask import Response

    name = filename(stem, fmt)
    headers = {
        "Content-Disposition": f'attachment; filename="{name}"',
        # Proxies that buffer a streamed response defeat the point of
        # streaming it, and nginx is configured not to for exactly this.
        "X-Accel-Buffering": "no",
        "Cache-Control": "no-store",
    }

    if fmt == "xlsx":
        return Response(xlsx_bytes(rows, columns), mimetype=CONTENT_TYPES[fmt], headers=headers)

    body = json_lines(rows, columns) if fmt == "json" else csv_lines(rows, columns)
    return Response(body, mimetype=CONTENT_TYPES[fmt], headers=headers)


def refuse_if_truncated(statement, *, fmt: str, what: str = "rows") -> int:
    """Count first, and refuse rather than hand back a plausible-looking half.

    `stream_rows` applies a `LIMIT`, which for a long time meant an export of
    200,000 rows produced 50,000 of them with a `200` on it and no indication
    anywhere that the file was a fragment. That is the worst shape a data bug
    can take: quiet, plausible, and impossible for the person holding the file
    to notice. The comment on `MAX_ROWS` had said since it was written that
    such an export "must become a background job" — this is what makes that
    true instead of aspirational.

    A count is one extra query against the same statement, which is cheap
    beside the export it guards. Returns the count so a caller can report it.
    """
    from src.core.db import session_scope
    from src.core.errors import ValidationError
    from src.core.query import count_of

    ceiling = limit_for(fmt)
    with session_scope() as session:
        total = count_of(session, statement)

    if total > ceiling:
        raise ValidationError(
            f"That is {total:,} {what}, and a download stops at {ceiling:,}. "
            "Queue it as an export instead and the whole set is produced in the "
            "background.",
            details={
                "total": total,
                "maximum": ceiling,
                "format": fmt,
                # So a page can offer the queued path without guessing.
                "queue_instead": True,
            },
        )
    return total


def stream_rows(statement, *, limit: int, session: Any = None) -> Iterator[Any]:
    """Rows from a statement, in batches, on a session of the generator's own.

    The session is opened here rather than by the caller because the response
    is returned before the first row is read: a `session_scope()` in the
    handler would already have closed by the time this ran, and the export
    would fail after the headers had gone out — a truncated download with a
    200 on it.

    `session` is for the caller who is *not* a response: `write_to` consumes
    every row before it returns, so a background export (§30) and the seed pass
    that produces the demo artefacts both have a live session to read on. It is
    not an optimisation — it is a correctness fix. A separate session reads a
    separate transaction, so the seed produced an export of *zero* rows over a
    table whose fifty rows were sitting uncommitted in the session it had been
    handed, and recorded that as a finished export of fifty units.
    """
    from src.core.db import session_scope

    # `nullcontext` when a session is supplied: the caller's transaction is the
    # one to read in, and closing it here would be closing somebody else's.
    scope = contextlib.nullcontext(session) if session is not None else session_scope()
    with scope as session:
        # `partitions` rather than `yield_per`: both keep memory bounded, but
        # `yield_per` holds a *server-side cursor* open across the whole
        # response, and this generator is consumed by the WSGI server after the
        # view has returned. Something in that path was closing the result
        # early: an audit export of 1042 rows wrote 1001 of them one run and
        # 1008 the next, with a 200 on it — the truncated download this
        # function's docstring exists to prevent, arriving by a route nobody
        # had thought of. `partitions` fetches a chunk, materialises it, and
        # only then hands the rows over, so an interrupted response loses the
        # chunk it was in rather than everything after the first.
        result = session.scalars(statement.limit(limit)).unique()
        count = 0
        for chunk in result.partitions(BATCH):
            for row in chunk:
                yield row
                count += 1
                if count >= limit:
                    return
