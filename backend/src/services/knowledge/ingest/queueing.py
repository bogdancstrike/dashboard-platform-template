"""Queueing an ingest job and running it."""

from __future__ import annotations

from typing import Any

from src.core import background, storage
from src.core.clock import iso, now
from src.core.db import session_scope
from src.services.knowledge.ingest.chunking import chunk
from src.services.knowledge.ingest.embedding import store
from src.services.knowledge.ingest.model import JOB_KIND, JOB_QUEUE, IngestError
from src.services.knowledge.ingest.parsing import parse


def _line(message: str, level: str = "INFO") -> dict[str, Any]:
    return {"at": iso(now()), "level": level, "message": message}


def queue(session, document, *, principal=None) -> None:
    """Give a document a job and start reading it once the caller commits.

    The caller commits and then calls `start(document_id)`; spawning here would
    look for a row that is still inside this transaction.
    """
    from src.models.platform import BackgroundJob

    file = document.file
    job = BackgroundJob(
        reference=_reference(document),
        name=f"Read {file.name if file else 'document'}"[:200],
        kind=JOB_KIND,
        queue=JOB_QUEUE,
        status="QUEUED",
        priority="NORMAL",
        progress=0,
        total_units=1,
        processed_units=0,
        failed_units=0,
        attempt=1,
        max_attempts=1,
        initiated_by_id=getattr(principal, "user_id", None),
        initiated_by_label=getattr(principal, "full_name", None) or "System",
        organization_id=getattr(principal, "organization_id", None),
        payload={"document_id": str(document.id), "collection_id": str(document.collection_id)},
        log_lines=[_line(f"queued {file.name if file else ''}".strip())],
    )
    session.add(job)
    session.flush()
    document.job_id = job.id
    document.status = "QUEUED"
    document.error_code = None
    document.error_message = None
    session.flush()


def _reference(document) -> str:
    """`ING-<document>-<n>`: unique without asking the table.

    A sequence read from `MAX(reference)` raced when several files of one drop
    were added at the same moment — two requests read the same maximum and the
    second insert hit the unique index. The document id is already unique; a
    short random tail keeps each reprocess its own job.
    """
    from uuid import uuid4

    return f"ING-{document.id.hex[:12].upper()}-{uuid4().hex[:4].upper()}"


def start(document_id: Any) -> str:
    return background.spawn(lambda: run(document_id), name=f"ingest:{document_id}")


def run(document_id: Any) -> None:
    """Read one document. Owns its sessions and records every outcome."""
    from src.core import features
    from src.models.knowledge import KnowledgeDocument

    if not features.job_allowed("knowledge.ingest"):
        # Left queued: it is read when the feature is switched back on.
        return
    from src.models.platform import BackgroundJob

    started = now()
    with session_scope() as session:
        document = session.get(KnowledgeDocument, document_id)
        if document is None or document.status not in ("QUEUED", "FAILED", "READY"):
            return
        document.status = "PARSING"
        document.started_at = started
        job = session.get(BackgroundJob, document.job_id) if document.job_id else None
        if job is not None:
            job.status = "RUNNING"
            job.started_at = started
            job.progress = 10
            job.log_lines = [*(job.log_lines or []), _line(f"started ({background.mechanism()})")]
        file = document.file
        key, name = (file.storage_key or "", file.name) if file else ("", "")

    try:
        if not key:
            raise IngestError("FILE_MISSING", "The file this document points at is gone.")
        try:
            data = storage.for_config().get(key)
        except Exception as exc:  # noqa: BLE001 - any storage failure is the same answer here
            raise IngestError("FILE_MISSING", "The file's bytes are not in storage.") from exc
        parsed = parse(data, name)
        with session_scope() as session:
            document = session.get(KnowledgeDocument, document_id)
            document.status = "CHUNKING"
            if parsed.pages:
                document.pages = parsed.pages
        passages = chunk(parsed.sections)
        with session_scope() as session:
            document = session.get(KnowledgeDocument, document_id)
            document.status = "EMBEDDING"
            document.chunk_count = len(passages)
            job = session.get(BackgroundJob, document.job_id) if document.job_id else None
            if job is not None:
                job.progress = 50
                job.log_lines = [*(job.log_lines or []), _line(
                    f"parsed with {parsed.parser}: {len(parsed.sections)} sections"
                    + (f", {parsed.pages} pages" if parsed.pages else "")
                )]
        with session_scope() as session:
            document = session.get(KnowledgeDocument, document_id)
            outcome = store(session, document, parsed, passages)
            finished = now()
            document.status = "READY"
            document.ingested_at = finished
            job = session.get(BackgroundJob, document.job_id) if document.job_id else None
            if job is not None:
                job.status = "SUCCEEDED"
                job.progress = 100
                job.processed_units = 1
                job.finished_at = finished
                job.duration_ms = int((finished - started).total_seconds() * 1000)
                job.result = {**outcome, "ran_as": background.mechanism()}
                job.log_lines = [*(job.log_lines or []), _line(
                    f"stored {outcome['chunks']} passages, {outcome['embedded']} embedded"
                ), _line("finished")]
    except Exception as exc:  # noqa: BLE001 - the document records every outcome
        code = exc.code if isinstance(exc, IngestError) else "INGEST_FAILED"
        message = exc.message if isinstance(exc, IngestError) else f"{type(exc).__name__}: {exc}"[:500]
        with session_scope() as session:
            document = session.get(KnowledgeDocument, document_id)
            if document is None:
                return
            finished = now()
            document.status = "FAILED"
            document.error_code = code
            document.error_message = message
            job = session.get(BackgroundJob, document.job_id) if document.job_id else None
            if job is not None:
                job.status = "FAILED"
                job.finished_at = finished
                job.failed_units = 1
                job.duration_ms = int((finished - started).total_seconds() * 1000)
                job.error_message = f"{code}: {message}"[:500]
                job.log_lines = [*(job.log_lines or []), _line(f"failed: {code}", level="ERROR")]
