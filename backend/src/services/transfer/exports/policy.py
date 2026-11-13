"""The settings that bound an export: row cap, retention, staleness, references."""

from __future__ import annotations

from typing import Any

from sqlalchemy import func, select

from src.core.clock import iso, now
from src.models.platform import BackgroundJob

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


#: The prefix an export's human identifier carries. `EXP-000123` rather than
#: the `JOB-` the seeded queue uses, because an export is the one job kind
#: somebody quotes back at you ("I downloaded EXP-000012 and it was empty").
REFERENCE_PREFIX = "EXP"


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
