"""Exports somebody asked for and can come back to (§30).

`core/export` answers a download inside the request. This module is the other
half: the export that is too big for one, and therefore has to exist as a
*thing* — a row with a reference, a status, a row count and a file — rather
than as a response that either arrived or did not.

Five decisions, each of which is a mistake this file exists not to make.

**The refusal and the queue are the same number.** A download stops at
`core/export.MAX_ROWS`; above it `refuse_if_truncated` raises and says to queue
one instead. That message named a path that did not exist until this module,
which is the worst kind of error message — one that tells somebody to do
something the product does not offer. `limits.max_export_rows` is the bound on
the queued path, and it is read from the settings table rather than declared
here, so the number an administrator edits is the number that applies.

**A queued export is the same question as the download would have been.**
Both build their statement from an `explorer.Plan`, so an export that queued
*because* it was large cannot quietly be a different query from the one the
person was looking at. The plan is stored on the job, re-validated when it
runs, and re-described from the resource's own field catalogue — never from a
sentence saved beside it that would go stale.

**The file is produced, not promised.** There is no worker in this stack, so
`core/background` runs the work off the request inside this process and records
which mechanism did it. What comes back is genuine: real rows, a real byte
count, a real checksum, and a download that returns them. A page whose every
download fails is not a demonstration of anything — the same argument
`seed/blobs` makes about files, and the reason the seeded exports have real
artefacts too.

**The person who asked is the person who may fetch it.** An export is a copy of
whatever rows its requester could see, filtered however they filtered them, and
a link to it is a link to those rows. So `/exports` lists your own and a
download requires being the initiator — administrators included, deliberately.
An administrator who needs somebody's export can run the query themselves,
which leaves an audit entry in their own name; a download endpoint that made an
exception for them would be a way to read another person's data with no such
record. Job *metadata* stays visible to `jobs.view` on `/admin/jobs`, because a
queue console that cannot see its own queue is useless.

**An artefact expires, and is discarded before the record is.**
`retention.export_days` bounds how long the bytes live, and the bytes are
dropped the moment an expired one is asked for — lazy, because there is no
sweeper to be honest about, and cheap because it happens exactly where the fact
is discovered. `forget` is the manual version, and it takes two presses: the
first removes the file, the second removes the record. Two, because the acts
are different sizes — one takes a copy of production data out of object
storage, the other tidies away somebody's own note that they asked for it — and
because the history that matters lives in the audit trail (`export.queue`,
`export.download`, `export.forget`, `export.remove`), which the requester
cannot edit. The first design kept the row forever by analogy with
`/admin/jobs`; that analogy fails, because a queue console shows scheduled work
nobody asked for personally, and this shows one person's own requests.
"""

from __future__ import annotations

import tempfile
from typing import Any

from sqlalchemy import Select, func, select

from src.core import audit, background, storage, vocabulary
from src.core.clock import iso, now
from src.core.db import session_scope
from src.core.errors import ConflictError, NotFoundError, ValidationError
from src.core.export import CONTENT_TYPES, FORMATS, MAX_ROWS, MAX_XLSX_ROWS, limit_for
from src.core.pagination import envelope, parse_page, parse_uuid
from src.core.query import Field, FieldSet, apply_filters, apply_sort, count_of, facets_for
from src.models.platform import BackgroundJob
from src.services import explorer

#: The same privilege that takes a copy of a list away. Exporting in the
#: background is not a different act, only a slower one — and the navigation
#: entry for `/exports` declares this permission, so the two must agree or the
#: page's own route guard contradicts its API.
PERMISSION = "records.export"

#: The job kind this module owns. `/admin/jobs` shows every kind; this shows one.
KIND = "EXPORT"

#: The queue name a queued export goes on, so `/admin/jobs` can group them.
QUEUE = "exports"

#: What `limits.max_export_rows` falls back to when the settings table has not
#: been seeded. The same value the setting ships with, and stated once: two
#: numbers that must agree are one number too many.
DEFAULT_MAX_ROWS = 100_000

#: What `retention.export_days` falls back to, for the same reason.
DEFAULT_RETENTION_DAYS = 7

#: How many exports one person may have waiting at once. A queue is a shared
#: resource and this process is also serving requests: without a bound, a page
#: with a button on it is a page that can be leaned on.
MAX_PENDING_PER_PERSON = 3

#: Statuses that mean the work has not finished yet, named from the same
#: vocabulary `/admin/jobs` uses.
_PENDING = ("QUEUED", "RUNNING", "RETRYING")

#: How long a pending export may go without finishing before it is read as
#: stalled rather than as in progress.
#:
#: This is not a timeout — nothing is cancelled — it is an *interpretation*, and
#: it exists because `core/background` says plainly that in-flight work is lost
#: when the process restarts. A deployment mid-export leaves a row saying
#: QUEUED that nothing will ever pick up, and so does the seeded queue, whose
#: pending exports were never running in the first place. Without this, a page
#: shows a spinner forever and three such rows exhaust `MAX_PENDING_PER_PERSON`
#: permanently. Generous enough that a genuinely slow export is not mislabelled.
STALL_AFTER_SECONDS = 15 * 60


# ── the plan, and the settings that bound it ─────────────────────────────


def _setting(session, key: str, fallback: int) -> int:
    """One numeric setting, or its shipped default.

    Read from the row `/admin/settings` edits rather than from configuration:
    a page that told somebody "up to 100,000 rows" while the setting said
    250,000 would be a page lying about its own limits.
    """
    from src.models.platform import SystemSetting

    row = session.scalar(select(SystemSetting).where(SystemSetting.key == key))
    if row is None:
        return fallback
    value = (row.value or {}).get("value")
    return int(value) if isinstance(value, (int, float)) and value > 0 else fallback


def max_rows(session) -> int:
    """The ceiling on a queued export — `limits.max_export_rows`."""
    return _setting(session, "limits.max_export_rows", DEFAULT_MAX_ROWS)


def retention_days(session) -> int:
    """How long an artefact's bytes are kept — `retention.export_days`."""
    return _setting(session, "retention.export_days", DEFAULT_RETENTION_DAYS)


def expires_at(row, days: int):
    """When this export's bytes stop being available.

    Derived from when it finished rather than stored: the setting can be
    changed, and an `expires_at` column written at queue time would keep
    answering the old value.
    """
    from datetime import timedelta

    if not row.finished_at or not (row.result or {}).get("artifact"):
        return None
    return row.finished_at + timedelta(days=days)


def _expired(row, days: int) -> bool:
    when = expires_at(row, days)
    return when is not None and when <= now()


def stalled(row) -> bool:
    """Whether a pending export has been pending too long to still be running.

    Derived rather than written by a sweeper, because the situation it
    describes is precisely the one in which no code of ours got to run.
    """
    from datetime import timedelta

    if row.status not in _PENDING:
        return False
    since = row.started_at or row.created_at
    return since is not None and since + timedelta(seconds=STALL_AFTER_SECONDS) <= now()


# ── reading ──────────────────────────────────────────────────────────────


def _fields() -> FieldSet:
    """What an export list can be filtered and sorted by.

    Deliberately short. This is somebody's own small list of recent requests,
    not a dataset — a facet panel over four rows is furniture, not a feature.
    """
    return FieldSet(
        Field("reference", BackgroundJob.reference, label="Reference", searchable=True),
        Field("name", BackgroundJob.name, label="Export", searchable=True),
        Field("status", BackgroundJob.status, kind="enum", label="Status", facet=True,
              choices=vocabulary.JOB_STATUS),
        Field("created_at", BackgroundJob.created_at, kind="datetime", label="Requested"),
        Field("finished_at", BackgroundJob.finished_at, kind="datetime", label="Finished"),
    )


def _mine(principal) -> Select:
    """This person's exports, and nobody else's. See the module note."""
    return select(BackgroundJob).where(
        BackgroundJob.kind == KIND,
        BackgroundJob.initiated_by_id == principal.user_id,
    )


def _serialise(row, *, days: int) -> dict[str, Any]:
    """One export as the page reads it.

    Everything about the file is taken from `result`, which the run wrote from
    the object it actually stored — never from the request that asked for it.
    An export row that reports the row count somebody hoped for is the defect
    the seeded rows used to carry.
    """
    result = row.result or {}
    payload = row.payload or {}
    stored_rows = result.get("rows")
    expiry = expires_at(row, days)
    gone = _expired(row, days)
    stuck = stalled(row)

    return {
        "id": str(row.id),
        "reference": row.reference,
        "name": row.name,
        "status": row.status,
        "resource_type": payload.get("resource_type") or "",
        "format": payload.get("format") or "",
        "description": _describe(payload),
        "columns": list(payload.get("columns") or []),
        "rows": int(stored_rows) if isinstance(stored_rows, int) else None,
        "size_bytes": result.get("size_bytes"),
        "checksum": result.get("checksum"),
        "requested_at": iso(row.created_at),
        "started_at": iso(row.started_at),
        "finished_at": iso(row.finished_at),
        "duration_ms": row.duration_ms,
        "progress": row.progress,
        "attempt": row.attempt,
        "max_attempts": row.max_attempts,
        "error_message": row.error_message,
        # Which of `core/background`'s mechanisms produced it, so a slow export
        # can be read for what it is rather than guessed at.
        "ran_as": result.get("ran_as") or "",
        "expires_at": iso(expiry) if expiry else None,
        "expired": gone,
        # Pending for longer than anything could plausibly still be running.
        # Said out loud rather than shown as a spinner that never stops.
        "stalled": stuck,
        # Derived from the row rather than from a `stat` per line: a page of
        # twenty-five would otherwise be twenty-five round trips to object
        # storage. The download verifies for real, because it has to anyway.
        "downloadable": bool(result.get("artifact")) and not gone and row.status == "SUCCEEDED",
        # Whether there is a file *at all*, which is not the same question.
        # `forget` takes two presses and this is what decides which press the
        # next one is — and it has to be said rather than inferred, because
        # `rows` and `size_bytes` survive a discard: "1,284 rows, 88 KB" is the
        # history the record exists to keep. A page guessing from `size_bytes`
        # got the second press wrong, and only the real stack showed it.
        "has_file": bool(result.get("artifact")),
        "log_lines": list(row.log_lines or []),
    }


def _describe(payload: dict[str, Any]) -> str:
    """The stored question in a sentence, or why it cannot be read.

    Re-derived from the resource's field catalogue every time rather than
    stored beside the plan: a description saved at queue time is a second copy
    of the query that starts being wrong as soon as a field is relabelled.
    """
    try:
        return explorer.replan(payload).describe()
    except ValidationError:
        # A resource or column that no longer exists. Worth saying plainly:
        # the row is still a record of what somebody asked for.
        return "This export's query refers to fields that no longer exist."


def catalogue(session, *, principal) -> dict[str, Any]:
    """What can be exported, how large it may be, and where mine stand."""
    principal.require(PERMISSION)

    datasets = [
        {
            "key": resource.key,
            "label": resource.label,
            "description": resource.description,
            "columns": list(resource.default_columns),
            "fields": [
                {"name": field.name, "label": field.title, "kind": field.kind}
                for field in resource.fields.fields
            ],
        }
        for resource in sorted(explorer.resources().values(), key=lambda item: item.label)
        if principal.can(resource.permission)
    ]

    # Counted in PostgreSQL rather than by loading the rows: this is somebody's
    # own list today and their two years of exports eventually (§71).
    tallied = session.execute(
        select(BackgroundJob.status, func.count(BackgroundJob.id))
        .where(BackgroundJob.kind == KIND, BackgroundJob.initiated_by_id == principal.user_id)
        .group_by(BackgroundJob.status)
    ).all()
    statuses = {status: int(count) for status, count in tallied}

    days = retention_days(session)
    ceiling = max_rows(session)
    # Expiry is derived from `finished_at` and a setting, so the only rows that
    # can be expired are the finished ones — which is a short list to read.
    finished = session.scalars(
        _mine(principal).where(BackgroundJob.status == "SUCCEEDED")
    ).all()
    # Likewise "stalled": only a pending row can be one.
    pending_rows = session.scalars(
        _mine(principal).where(BackgroundJob.status.in_(_PENDING))
    ).all()
    stuck = sum(1 for row in pending_rows if stalled(row))
    waiting = [row for row in pending_rows if not stalled(row)]

    return {
        "datasets": datasets,
        "formats": [
            {
                "key": fmt,
                "label": fmt.upper(),
                "content_type": CONTENT_TYPES[fmt],
                # The spreadsheet ceiling is a property of the format — a zip
                # container has to be finished before it can be sent — so the
                # setting bounds it but cannot raise it.
                "maximum": min(ceiling, MAX_XLSX_ROWS) if fmt == "xlsx" else ceiling,
            }
            for fmt in FORMATS
        ],
        "max_rows": ceiling,
        "streams_up_to": MAX_ROWS,
        "retention_days": days,
        "pending_limit": MAX_PENDING_PER_PERSON,
        "pending": len(waiting),
        "stalled": stuck,
        "statuses": [{"key": status, "count": statuses[status]} for status in sorted(statuses)],
        "total": sum(statuses.values()),
        "expired": sum(1 for row in finished if _expired(row, days)),
        "ready": sum(
            1
            for row in finished
            if (row.result or {}).get("artifact") and not _expired(row, days)
        ),
    }


def listing(session, args, *, principal) -> dict[str, Any]:
    """One page of my exports, newest first."""
    principal.require(PERMISSION)
    fields = _fields()
    page = parse_page(args, default_sort="created_at")

    statement = apply_filters(_mine(principal), args, fields)
    total = count_of(session, statement)
    facets = facets_for(session, statement, fields)
    statement = apply_sort(statement, page, fields, default="created_at")
    rows = session.scalars(statement.offset(page.offset).limit(page.page_size)).all()

    days = retention_days(session)
    return envelope(
        [_serialise(row, days=days) for row in rows],
        total,
        page,
        facets=facets,
        fields=fields.describe(),
        columns=["reference", "name", "status", "rows", "created_at"],
    )


def _row_for(session, ident: Any, *, principal) -> BackgroundJob:
    """One of my exports, or a 404 that does not say whose it was.

    A "that belongs to somebody else" message is a way to confirm a reference
    exists, so an export that is not mine is one that is not there.
    """
    row = session.get(BackgroundJob, parse_uuid(ident, field="export id"))
    if row is None or row.kind != KIND or row.initiated_by_id != principal.user_id:
        raise NotFoundError("That export does not exist.", details={"id": str(ident)})
    return row


def entry(session, ident: Any, *, principal) -> dict[str, Any]:
    """One export, with its log lines."""
    principal.require(PERMISSION)
    return _serialise(_row_for(session, ident, principal=principal), days=retention_days(session))


# ── queueing ─────────────────────────────────────────────────────────────


def estimate(session, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    """How many rows this question has, before anybody commits to a file.

    Its own endpoint because the answer changes what the page should offer: a
    small export should be the immediate download, and a page that queued a
    forty-row CSV as a background job would be a page adding a step for
    nothing.
    """
    principal.require(PERMISSION)
    plan = explorer.plan_for(payload, principal=principal)
    total = count_of(session, explorer.statement_of(plan))
    ceiling = max_rows(session)

    return {
        "resource_type": plan.resource_type,
        "format": plan.fmt,
        "description": plan.describe(),
        "columns": list(plan.columns),
        "rows": total,
        "maximum": ceiling,
        "streams_up_to": MAX_ROWS,
        # What the page should do with it: download it now, or queue it. The
        # streaming ceiling is `core/export`'s own, asked of it rather than
        # restated, so the answer here and the refusal there agree.
        "can_stream": total <= limit_for(plan.fmt),
        "can_queue": total <= ceiling,
        "too_large": total > ceiling,
    }


def queue(session, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    """Accept an export, and start producing it off the request.

    The count happens here, before the row is written, so an export that
    cannot be produced is refused with the number rather than accepted and
    failed later. `total_units` is that count: a progress bar over a total
    nobody measured is decoration.
    """
    principal.require(PERMISSION)
    plan = explorer.plan_for(payload, principal=principal)

    # Counted in Python over the pending rows rather than in SQL, because
    # "stalled" is derived from a clock and a threshold: a `WHERE created_at >
    # now() - interval` would be the same rule spelled a second way, and the
    # one that would drift is whichever a reader trusted.
    waiting = [
        row
        for row in session.scalars(_mine(principal).where(BackgroundJob.status.in_(_PENDING)))
        if not stalled(row)
    ]
    pending = len(waiting)
    if pending >= MAX_PENDING_PER_PERSON:
        raise ConflictError(
            f"You already have {pending} exports in progress, which is the limit. "
            "Wait for one to finish, or discard it.",
            details={
                "pending": pending,
                "maximum": MAX_PENDING_PER_PERSON,
                "references": [row.reference for row in waiting],
            },
        )

    total = count_of(session, explorer.statement_of(plan))
    ceiling = max_rows(session)
    if total > ceiling:
        raise ValidationError(
            f"That is {total:,} rows, and this installation exports at most "
            f"{ceiling:,}. Narrow the query, or raise limits.max_export_rows.",
            details={"total": total, "maximum": ceiling, "setting": "limits.max_export_rows"},
        )

    row = BackgroundJob(
        reference=_reference(session),
        name=f"{plan.resource.label} — {plan.fmt.upper()}",
        kind=KIND,
        queue=QUEUE,
        status="QUEUED",
        priority="NORMAL",
        progress=0,
        total_units=total,
        processed_units=0,
        failed_units=0,
        attempt=1,
        # One attempt: a failed export is re-requested, not retried. Retrying
        # would re-run the same query against rows that have since changed, and
        # hand somebody a file whose name says one moment and whose contents
        # say another.
        max_attempts=1,
        initiated_by_id=principal.user_id,
        initiated_by_label=principal.full_name,
        organization_id=principal.organization_id,
        payload=plan.stored(),
        log_lines=[_line("accepted", f"{total:,} rows to write")],
    )
    session.add(row)
    session.flush()

    audit.record(
        session,
        action="export.queue",
        resource_type="export",
        resource_id=row.id,
        resource_label=row.reference,
        principal=principal,
        # The query, not its results: an audit row that carried the rows would
        # be a second copy of the data the export is already a copy of.
        after={
            "rows": total,
            "format": plan.fmt,
            "resource": plan.resource_type,
            "question": plan.describe(),
        },
    )
    session.commit()

    # Spawned after the commit, or the job would look for a row that is still
    # inside this transaction.
    job_id = row.id
    mechanism = background.spawn(lambda: run(job_id), name=f"export:{row.reference}")

    # Re-read, because the answer depends on which mechanism ran it and this
    # response should say what is true rather than what was true a moment ago:
    # a greenlet has not started yet and the row is genuinely QUEUED, while
    # `synchronous()` has already finished and the row is SUCCEEDED. Reporting
    # QUEUED in both cases would make the page poll for a file that is there.
    session.refresh(row)
    return {**_serialise(row, days=retention_days(session)), "ran_as": mechanism}


#: The prefix an export's human identifier carries. `EXP-000123` rather than
#: the `JOB-` the seeded queue uses, because an export is the one job kind
#: somebody quotes back at you ("I downloaded EXP-000012 and it was empty").
REFERENCE_PREFIX = "EXP"


def again(session, ident: Any, *, principal) -> dict[str, Any]:
    """Queue a *new* export from an existing one's stored question.

    Not a retry, deliberately, and this is the difference worth being precise
    about: retrying would re-run the old job in place, and the rows have moved
    on since it was asked for — a file whose reference says one moment and
    whose contents say another is worse than no file. So this reads the plan
    off the old row and asks the question again, now: a new reference, a new
    file, and the old record left exactly as it was.

    It is what the page offers on a failed export and on a stalled one, which
    is the same offer for the same reason.
    """
    principal.require(PERMISSION)
    row = _row_for(session, ident, principal=principal)
    # Validated through the ordinary path, so a plan whose columns no longer
    # exist is refused here rather than inside the background job.
    return queue(session, dict(row.payload or {}), principal=principal)


def _reference(session) -> str:
    """The next `EXP-000123`, from `MAX(reference)` as `core/naming` prescribes.

    One index scan rather than a count of the table, which is why the padding
    is fixed width. The retry loop is for the race between two people pressing
    the button in the same instant: `reference` is unique in the schema, so the
    alternative to retrying is a 500.
    """
    from src.core.naming import identifier, sequence_of

    latest = session.scalar(
        select(func.max(BackgroundJob.reference)).where(
            BackgroundJob.reference.like(f"{REFERENCE_PREFIX}-%")
        )
    )
    number = sequence_of(latest, prefix=REFERENCE_PREFIX) + 1
    candidate = identifier(REFERENCE_PREFIX, number, width=6)
    while session.scalar(select(BackgroundJob.id).where(BackgroundJob.reference == candidate)):
        number += 1
        candidate = identifier(REFERENCE_PREFIX, number, width=6)
    return candidate


def _line(message: str, detail: str = "", *, level: str = "INFO") -> dict[str, Any]:
    return {
        "at": iso(now()),
        "level": level,
        "message": f"{message}: {detail}" if detail else message,
    }


# ── producing ────────────────────────────────────────────────────────────


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


# ── downloading, and letting go ──────────────────────────────────────────


def download(session, ident: Any, *, principal) -> dict[str, Any]:
    """A URL for the file, signed so the bytes do not pass through here.

    Four things have to be true, and each is checked rather than assumed: the
    export is mine, it succeeded, it has not expired, and the object is
    actually in storage. The last one is not paranoia — an artefact can be
    removed from the bucket by anything with access to it, and a signed URL to
    a missing object is a download that fails with the wrong error.
    """
    principal.require(PERMISSION)
    row = _row_for(session, ident, principal=principal)
    result = row.result or {}

    if row.status != "SUCCEEDED":
        raise ConflictError(
            f"That export is {row.status.lower()}; there is no file yet.",
            details={"status": row.status, "reference": row.reference},
        )

    key = str(result.get("artifact") or "")
    days = retention_days(session)
    if _expired(row, days):
        # Discovered here, so dropped here. There is no sweeper in this stack
        # and pretending otherwise would leave the bytes forever.
        _drop(session, row, note=f"expired after {days} days")
        session.commit()
        raise ConflictError(
            f"That export's file was kept for {days} days and has expired. "
            "Request it again to get a fresh one.",
            details={"reference": row.reference, "retention_days": days, "expired": True},
        )

    store = storage.for_config()
    if not key or store.stat(key) is None:
        _drop(session, row, note="artefact is not in storage")
        session.commit()
        raise NotFoundError(
            "That export's file is no longer in storage. Request it again.",
            details={"reference": row.reference},
        )

    signed = store.download_url(key, filename=str(result.get("filename") or f"{row.reference}"))
    # Recorded because it is the moment a copy of the data leaves: the queue
    # entry says somebody asked, and only this says somebody fetched.
    audit.record(
        session,
        action="export.download",
        resource_type="export",
        resource_id=row.id,
        resource_label=row.reference,
        principal=principal,
        metadata={"rows": result.get("rows"), "size_bytes": result.get("size_bytes")},
    )
    session.commit()

    return {
        "url": signed.url,
        "method": signed.method,
        "expires_in": signed.expires_in,
        "filename": result.get("filename"),
        "content_type": result.get("content_type"),
        "size_bytes": result.get("size_bytes"),
        "rows": result.get("rows"),
    }


def forget(session, ident: Any, *, principal) -> dict[str, Any]:
    """Drop the file first; remove the record on a second ask.

    Two presses, which is the platform's own rule for this shape of thing —
    `/mail` bins a thread on the first delete and removes it on the second —
    and it is two presses because the two acts are different sizes. The first
    removes a *copy of production data* from object storage, which is the part
    somebody may urgently want gone. The second removes their own note that
    they once asked for it, which is housekeeping.

    Keeping the record forever was the first design, on the reasoning that
    `/admin/jobs` keeps cancelled jobs so somebody can answer "why did the
    nightly export not run last Tuesday". That reasoning does not transfer:
    those are *scheduled* jobs nobody asked for personally, while this is a
    list of one person's own requests, and a list of four hundred discarded
    ones answers nothing. The history that matters is not lost either — the
    audit trail carries `export.queue`, `export.download` and `export.forget`,
    and unlike this row the requester cannot edit it.

    Reported as `removed` so a caller knows which of the two happened.
    """
    principal.require(PERMISSION)
    row = _row_for(session, ident, principal=principal)

    if row.status in _PENDING and not stalled(row):
        raise ConflictError(
            "That export is still being produced. Wait for it to finish.",
            details={"status": row.status, "reference": row.reference},
        )

    if (row.result or {}).get("artifact"):
        _drop(session, row, note="discarded")
        audit.record(
            session,
            action="export.forget",
            resource_type="export",
            resource_id=row.id,
            resource_label=row.reference,
            principal=principal,
            before={"had_file": True},
        )
        session.commit()
        return {**_serialise(row, days=retention_days(session)), "removed": False}

    # Nothing left to take away but the note itself.
    reference = row.reference
    audit.record(
        session,
        action="export.remove",
        resource_type="export",
        resource_id=row.id,
        resource_label=reference,
        principal=principal,
        # Recorded before the row goes, because after it there is nothing to
        # read it off.
        before={"status": row.status, "question": _describe(row.payload or {})},
    )
    answer = {**_serialise(row, days=retention_days(session)), "removed": True}
    session.delete(row)
    session.commit()
    return answer


def _drop(session, row: BackgroundJob, *, note: str) -> None:
    """Remove an artefact's bytes and say on the row that they are gone.

    `artifact` is cleared rather than a flag set beside it: two fields that
    have to agree about whether a file exists are one field too many, and the
    one that would be wrong is whichever a reader trusted.
    """
    result = dict(row.result or {})
    key = str(result.pop("artifact", "") or "")
    if key:
        try:
            storage.for_config().delete(key)
        except Exception:  # noqa: BLE001 - the row must still record the intent
            # A bucket that refused the delete is worth recording and not worth
            # failing the request over: the row now says the file is gone, and
            # `--sync-exports` reconciles what is actually there.
            result["artifact_delete_failed"] = key

    result["artifact_removed"] = note
    result["artifact_removed_at"] = iso(now())
    row.result = result
    row.log_lines = [*(row.log_lines or []), _line("file removed", note)]
    session.flush()
