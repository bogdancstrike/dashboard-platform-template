"""Real files for the seeded exports (§30).

`seed/blobs` exists because a seeded file with a `storage_key` pointing at
nothing is a file manager whose every download fails, which demonstrates
nothing. An export is the same argument with a worse version of the problem:
the seeded export jobs did not merely lack their bytes, they *claimed* them —
`result` said `{"rows": 184203, "artifact": "exports/JOB-000004.csv"}` for a
file nobody had written, and the row count was a progress counter rather than a
count of anything.

So this module makes every seeded export true, and it does it by running the
same `services/exports.produce` that a real request runs. Nothing here writes a
plausible number:

**The query is resolvable.** The old payload named an `entity` no code could
turn into a dataset. It is now a resource key, validated through
`explorer.replan`, and a row whose query cannot be read is left alone and
reported rather than guessed at.

**The unit counts are the query's.** `total_units` used to be a random integer
up to 250,000, so a finished export could report itself 100% complete at 184,203
of 250,000 units — three numbers, no two of which agreed. They are now counted
from the statement the payload names.

**The artefact is the file that was written**, with the size and checksum of the
object storage actually holds.

Idempotent, and additive in the sense that matters: it writes bytes that are
missing and corrects numbers that describe them. It never invents an export and
never removes one. Safe on every seed, and on a database that predates any of
this — which is what `--sync-exports` is for.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import select

from src.core.clock import now
from src.core.errors import ApiError
from src.core.naming import identifier, sequence_of

#: Which explorer resource an old payload's `entity` meant. Only needed for
#: rows written before the payload was a plan; a fresh seed never uses it.
_LEGACY_ENTITY = {
    "project": "project",
    "order": "order",
    "ticket": "ticket",
    "customer": "customer",
}


def materialise(session, store) -> dict[str, int]:
    """Make every seeded export say something true, and write its file.

    Returns a tally rather than logging: the seed runner prints it, and a
    repair that reports "written: 0, corrected: 0" is a repair somebody can
    trust to have found nothing to do.
    """
    from src.models.platform import BackgroundJob
    from src.services import explorer, exports

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


#: The demo personas who hold the export privilege get one export they can
#: actually download.
#:
#: The same argument `sync_jobs` makes about empty statuses, one step further
#: on: the ordinary draw attributes exports to whoever it likes, and on this
#: installation it gave every one of the five personas either none or none that
#: had finished. Signing in and finding a list with nothing to download is the
#: "every download fails" problem displaced rather than solved.
#:
#: One each, not a spread: the failure and cancellation states are already
#: produced by the draw and asserted by the tests, and a repair that manufactured
#: a tidy row per state per person would be writing a demo rather than repairing
#: one.
GUARANTEED_DOWNLOADABLE = 1


def _guarantee(session, store) -> int:
    """Give every persona who may export one finished export. Additive."""
    from src.core import vocabulary
    from src.core.clock import now
    from src.models.identity import User
    from src.models.platform import BackgroundJob
    from src.services import explorer, exports
    from src.seed.identity import PERSONAS
    from src.seed.support import Rng

    anchor = now()
    # Seeded from the clock, as every repair is: a fixed seed regenerates the
    # same UUIDs, so a second run collides with the rows the first one wrote.
    rng = Rng(int(anchor.timestamp() * 1000), anchor).derive("exports-topup")

    people = session.scalars(
        select(User).where(
            User.username.in_([username for username, *_rest in PERSONAS]),
            User.deleted_at.is_(None),
        )
    ).all()

    written = 0
    for person in people:
        allowed = set((person.role.permissions if person.role else None) or ())
        if exports.PERMISSION not in allowed:
            # A viewer holds no export privilege, so an export attributed to
            # one would be a row the product would refuse to create.
            continue

        ready = [
            row
            for row in session.scalars(
                select(BackgroundJob).where(
                    BackgroundJob.kind == exports.KIND,
                    BackgroundJob.initiated_by_id == person.id,
                    BackgroundJob.status == "SUCCEEDED",
                )
            )
            if store.stat(str((row.result or {}).get("artifact") or "") or "-") is not None
        ]
        if len(ready) >= GUARANTEED_DOWNLOADABLE:
            continue

        # A dataset this person's role can actually read, chosen from the
        # registry rather than named here: a resource whose permission the
        # persona lacks is an export the API would refuse.
        candidates = [
            resource
            for key, resource in sorted(explorer.resources().items())
            if resource.permission in allowed
        ]
        if not candidates:
            continue
        resource = candidates[0]

        plan = explorer.replan({
            "resource_type": resource.key,
            "format": rng.pick(("csv", "json", "xlsx")),
        })
        row = BackgroundJob(
            id=rng.uuid(),
            reference=_next_reference(session),
            name=f"{resource.label} — {plan.fmt.upper()}",
            kind=exports.KIND,
            queue=exports.QUEUE,
            status="SUCCEEDED",
            priority="NORMAL",
            attempt=1,
            max_attempts=1,
            initiated_by_id=person.id,
            initiated_by_label=person.full_name,
            organization_id=person.organization_id,
            payload=plan.stored(),
            # Recent, because `retention.export_days` is measured from here and
            # an export seeded a month ago is one that arrives expired.
            started_at=rng.recent(days=1),
            log_lines=[
                {"at": anchor.isoformat(), "level": "INFO", "message": "accepted"},
                {"at": anchor.isoformat(), "level": "INFO", "message": "finished"},
            ],
        )
        row.finished_at = row.started_at
        session.add(row)
        session.flush()

        result = exports.produce(session, row, store=store)
        row.result = {**result, "ran_as": "seed"}
        row.total_units = row.processed_units = result["rows"]
        row.progress = 100
        row.duration_ms = rng.integer(400, 9_000)
        assert vocabulary.JOB_STATUS, "job statuses are declared in core/vocabulary"
        written += 1

    return written


def _next_reference(session) -> str:
    """The next `EXP-` reference, the way the service computes it.

    Delegated rather than reimplemented: two places that generate the same
    identifier are two places that can disagree about the next one.
    """
    from src.services.exports import _reference

    return _reference(session)


def _plan_of(row) -> Any:
    """The row's query as a plan, repairing a legacy payload on the way.

    Returns `None` when the payload cannot be turned into a query at all —
    which is a fact worth reporting, not an exception worth raising in the
    middle of a seed run.
    """
    from src.services import explorer

    payload = dict(row.payload or {})
    if not payload:
        return None

    # A payload from before the plan existed named `entity` instead.
    entity = payload.pop("entity", None)
    if entity and not payload.get("resource_type"):
        payload["resource_type"] = _LEGACY_ENTITY.get(str(entity), str(entity))

    try:
        plan = explorer.replan(payload)
    except ApiError:
        return None

    # Written back normalised, so the row now holds what the runtime holds and
    # the next pass has nothing to repair.
    row.payload = plan.stored()
    return plan


def _recount(row, total: int) -> bool:
    """Make the unit counts describe the query. True when something changed.

    A part-done export keeps the *proportion* the seed drew rather than being
    clamped to the new total: clamping turned a job that had done 30,144 of
    87,289 into one that had done 50 of 50 — a failed export reporting itself
    completely processed, which is a contradiction on the same row.
    """
    before = (row.total_units, row.processed_units, row.progress, row.failed_units)
    fraction = (row.processed_units or 0) / (row.total_units or 1)
    row.total_units = total

    if row.status == "SUCCEEDED":
        row.processed_units, row.progress, row.failed_units = total, 100, 0
    elif row.status == "QUEUED":
        row.processed_units, row.progress, row.failed_units = 0, 0, 0
    else:
        # Scaled, then held below the total: something that stopped part-way
        # has, by definition, not finished.
        row.processed_units = min(int(total * fraction), max(total - 1, 0))
        row.progress = int(row.processed_units / total * 100) if total else 0
        # A failure has to have failed something, and it cannot have failed
        # more units than are left.
        remaining = total - row.processed_units
        if row.status in ("FAILED", "RETRYING"):
            row.failed_units = min(max(row.failed_units or 1, 1), max(remaining, 1))
        else:
            # Cancelled is not failed: nothing went wrong, somebody stopped it.
            row.failed_units = 0

    return before != (row.total_units, row.processed_units, row.progress, row.failed_units)


def _rename(session, row) -> bool:
    """Give a legacy export the `EXP-` reference `/exports` shows.

    Seeded exports used to carry `JOB-000004` like every other job, so the page
    listed a mix of two prefixes and the next reference a person requested
    continued from neither. Only rows still carrying the old prefix are
    touched, which makes this run once.
    """
    from src.models.platform import BackgroundJob
    from src.services import exports

    if not (row.reference or "").startswith("JOB-"):
        return False

    number = sequence_of(row.reference, prefix="JOB")
    candidate = identifier(exports.REFERENCE_PREFIX, number, width=6)
    while session.scalar(
        select(BackgroundJob.id).where(BackgroundJob.reference == candidate)
    ):
        number += 1
        candidate = identifier(exports.REFERENCE_PREFIX, number, width=6)

    row.reference = candidate
    return True
