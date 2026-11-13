"""Producing the file off the request."""

from __future__ import annotations

import tempfile
from typing import Any

from src.core import background, storage
from src.core.clock import now
from src.core.db import session_scope
from src.core.export import CONTENT_TYPES
from src.models.platform import BackgroundJob
from src.services.records import explorer
from src.services.transfer.exports.policy import _PENDING, _line, max_rows


def produce(session, row: BackgroundJob, *, store=None) -> dict[str, Any]:
    """Write one export's file and record what was written.

    Separated from `run` because the seed needs exactly this and none of the
    status handling around it: a seeded export whose artefact was never written
    is a download button that 404s, and `seed/blobs` already settled that
    argument for files.

    Returns the `result` the job row should carry. Raises on failure — the
    caller decides what a failure means.
    """
    from src.core import export as writer

    store = store or storage.for_config()
    plan = explorer.replan(row.payload)
    statement = explorer.statement_of(plan)
    key = storage.key_for("exports", f"{row.reference}.{plan.fmt}")

    # Spooled: under the threshold it never touches the disk, above it never
    # holds the file in memory. Either way the process holds a buffer rather
    # than a copy of the table.
    with tempfile.SpooledTemporaryFile(max_size=8 * 1024 * 1024) as scratch:
        # Read on the caller's session: this consumes every row before it
        # returns, and a separate session would read a separate transaction —
        # which is how the seed produced an export of zero rows over a table it
        # had just filled.
        rows = writer.stream_rows(statement, limit=max_rows(session), session=session)
        written = writer.write_to(
            scratch, explorer.rows_of(plan, rows), explorer.columns_of(plan), fmt=plan.fmt
        )
        scratch.seek(0)
        stored = store.put(key, scratch, content_type=CONTENT_TYPES[plan.fmt])

    return {
        "artifact": stored.key,
        "filename": writer.filename(plan.resource_type, plan.fmt),
        "content_type": stored.content_type,
        "rows": written,
        "size_bytes": stored.size_bytes,
        "checksum": stored.checksum,
    }


def run(job_id: Any) -> None:
    """Produce a queued export. The background entry point.

    Owns its session and its failures, as `core/background` requires: there is
    no caller left to catch anything, so every outcome is written to the job
    row and nothing is raised out of here.
    """
    started = now()
    with session_scope() as session:
        row = session.get(BackgroundJob, job_id)
        if row is None or row.status not in _PENDING:
            return
        row.status = "RUNNING"
        row.started_at = started
        row.log_lines = [*(row.log_lines or []), _line("started", background.mechanism())]

    try:
        with session_scope() as session:
            row = session.get(BackgroundJob, job_id)
            if row is None:
                return
            result = produce(session, row)
            finished = now()
            row.status = "SUCCEEDED"
            row.progress = 100
            row.processed_units = result["rows"]
            row.finished_at = finished
            row.duration_ms = int((finished - started).total_seconds() * 1000)
            # `total_units` was counted at queue time and the file was written
            # later, so the two can differ legitimately — rows were added or
            # removed in between. The file's count is the true one, and saying
            # so beats a progress bar that reads 103%.
            row.total_units = max(row.total_units, result["rows"])
            row.result = {**result, "ran_as": background.mechanism()}
            row.log_lines = [
                *(row.log_lines or []),
                _line("wrote", f"{result['rows']:,} rows, {result['size_bytes']:,} bytes"),
                _line("finished"),
            ]
    except Exception as exc:  # noqa: BLE001 - the job records every outcome
        with session_scope() as session:
            row = session.get(BackgroundJob, job_id)
            if row is None:
                raise
            finished = now()
            row.status = "FAILED"
            row.finished_at = finished
            row.duration_ms = int((finished - started).total_seconds() * 1000)
            row.failed_units = row.total_units
            row.error_message = f"{type(exc).__name__}: {exc}"[:500]
            row.log_lines = [
                *(row.log_lines or []),
                _line("failed", str(exc)[:300], level="ERROR"),
            ]
