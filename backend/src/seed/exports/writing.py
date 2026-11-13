"""Seed data for exports: materialise."""

from __future__ import annotations

from sqlalchemy import select

from src.core.clock import now
from src.core.errors import ApiError
from src.seed.exports.guarantee import _guarantee
from src.seed.exports.recount import _plan_of, _recount, _rename


def materialise(session, store) -> dict[str, int]:
    """Make every seeded export say something true, and write its file.

    Returns a tally rather than logging: the seed runner prints it, and a
    repair that reports "written: 0, corrected: 0" is a repair somebody can
    trust to have found nothing to do.
    """
    from src.models.platform import BackgroundJob
    from src.services.records import explorer
    from src.services.transfer import exports

    written = 0
    corrected = 0
    renamed = 0
    unreadable = 0
    skipped = 0

    rows = session.scalars(
        select(BackgroundJob).where(BackgroundJob.kind == exports.KIND)
    ).all()

    for row in rows:
        if _rename(session, row):
            renamed += 1

        plan = _plan_of(row)
        if plan is None:
            unreadable += 1
            continue

        # Counted from the statement the payload names, so the progress a
        # reader sees is over a total that exists.
        from src.core.query import count_of

        total = count_of(session, explorer.statement_of(plan))
        if _recount(row, total):
            corrected += 1

        if row.status != "SUCCEEDED":
            # Nothing to write: a queued export has no file, and saying so is
            # the whole point of having cleared the seeded claim.
            if (row.result or {}).get("artifact"):
                row.result = {**(row.result or {}), "artifact": None}
                corrected += 1
            skipped += 1
            continue

        key = str((row.result or {}).get("artifact") or "")
        if key and store.stat(key) is not None:
            skipped += 1
            continue

        try:
            result = exports.produce(session, row, store=store)
        except ApiError:
            # A resource whose permission or shape has changed under a seeded
            # row. Recorded as unreadable rather than crashing a seed run.
            unreadable += 1
            continue

        row.result = {**result, "ran_as": "seed"}
        row.processed_units = result["rows"]
        row.total_units = max(row.total_units or 0, result["rows"])
        row.progress = 100
        # `finished_at` decides when the artefact expires, and a seeded export
        # finished in the past. Left as the seed drew it when it has one, and
        # given one now when it does not, or the file would read as expired
        # before anybody could download it.
        row.finished_at = row.finished_at or now()
        written += 1

    guaranteed = _guarantee(session, store)
    written += guaranteed

    session.flush()
    return {
        "written": written,
        "corrected": corrected,
        "renamed": renamed,
        "guaranteed": guaranteed,
        "unreadable": unreadable,
        "already_present": skipped,
    }
