"""Seed data for exports: _LEGACY_ENTITY, _rename, _recount."""

from __future__ import annotations

from typing import Any

from sqlalchemy import select

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


def _next_reference(session) -> str:
    """The next `EXP-` reference, the way the service computes it.

    Delegated rather than reimplemented: two places that generate the same
    identifier are two places that can disagree about the next one.
    """
    from src.services.transfer.exports import _reference

    return _reference(session)


def _plan_of(row) -> Any:
    """The row's query as a plan, repairing a legacy payload on the way.

    Returns `None` when the payload cannot be turned into a query at all —
    which is a fact worth reporting, not an exception worth raising in the
    middle of a seed run.
    """
    from src.services.records import explorer

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
    from src.services.transfer import exports

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
