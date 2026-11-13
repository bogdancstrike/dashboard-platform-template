"""Downloading an export, and forgetting it."""

from __future__ import annotations

from typing import Any

from src.core import audit, storage
from src.core.clock import iso, now
from src.core.errors import ConflictError, NotFoundError
from src.models.platform import BackgroundJob
from src.services.transfer.exports.policy import (
    _PENDING,
    PERMISSION,
    _expired,
    _line,
    retention_days,
    stalled,
)
from src.services.transfer.exports.reading import _describe, _row_for, _serialise


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
