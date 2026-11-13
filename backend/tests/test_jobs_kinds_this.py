"""The background job queue (§23). — the kinds this console does not own."""

from __future__ import annotations

from src.core import vocabulary
from src.core.clock import now
from src.core.db import session_scope
from src.services.platform import jobs as service
from tests.jobs_support import (  # noqa: F401
    JOBS,
    _authenticate,
    _job,
    _read,
    pytestmark,
)


def test_an_export_is_not_retried_here_but_re_requested_there(client, monkeypatch):
    """Two screens must not give opposite answers about the same row (§30).

    `/exports` refuses a retry deliberately: the stored query would run against
    rows that have moved on, and a file whose reference says one moment and
    whose contents say another is worse than no file. A queue console that
    retried the same row anyway would be the platform contradicting itself.
    """
    headers = _authenticate(monkeypatch, "admin", "administrator")
    job_id = _job(kind="EXPORT", status="CANCELLED", attempt=1, max_attempts=3)

    row = _read(client, headers, job_id)
    # Terminal and within its attempts, so the *only* reason it cannot be
    # retried is the kind — which is what makes this a test of the rule.
    assert row["status"] == "CANCELLED"
    assert row["attempt"] < row["max_attempts"]
    assert row["can_retry"] is False

    answer = client.post(f"{JOBS}/{job_id}/retry", headers=headers)
    assert answer.status_code == 409
    details = answer.get_json()["details"]
    assert details["kind"] == "EXPORT"
    # The refusal names where the right action lives, rather than leaving
    # somebody to guess or to grant attempts that would change nothing.
    assert "/exports" in details["instead"]
    assert service.NOT_OURS_TO_RETRY["EXPORT"] == details["instead"]


def test_a_kind_this_console_owns_is_still_retryable(client, monkeypatch):
    # The other half: the new rule must not have made everything unretryable.
    headers = _authenticate(monkeypatch, "admin", "administrator")
    job_id = _job(kind="REPORT", status="CANCELLED", attempt=1, max_attempts=3)

    assert _read(client, headers, job_id)["can_retry"] is True
    assert client.post(f"{JOBS}/{job_id}/retry", headers=headers).status_code == 200


def test_a_top_up_only_adds_jobs_this_console_can_retry():
    """`--sync-jobs` exists to provide something *actionable*.

    It drew its kind at random, EXPORT is 28% of that draw, and an export is
    not retryable — so a top-up could report "2 added" and leave the end-to-end
    suite failing for want of a retryable cancelled job. Which is exactly what
    happened, twice.
    """
    from src.seed.operations import background_job
    from src.seed.support import Rng
    from src.services.platform.jobs import NOT_OURS_TO_RETRY

    rng = Rng(1234, now())
    kinds = {
        background_job(
            rng, index=i, status="CANCELLED", users=[], scheduled_tasks=[], fresh=True
        ).kind
        for i in range(200)
    }
    assert kinds, "the generator produced nothing"
    assert not (kinds & set(NOT_OURS_TO_RETRY)), (
        f"a fresh top-up drew a kind this console cannot retry: {kinds & set(NOT_OURS_TO_RETRY)}"
    )


def test_the_repair_counts_what_the_console_can_actually_retry():
    """The repair and the guard must measure the same thing.

    `--sync-jobs` counted `attempt < max_attempts` and called that "fresh",
    which counted three cancelled *exports* the console will not retry — so it
    reported "every status already has the guaranteed minimum" while the queue
    had nothing retryable in it, twice. The count now uses the console's own
    rule.
    """
    from sqlalchemy import func
    from sqlalchemy import select as _select

    from src.models.platform import BackgroundJob
    from src.seed import runner

    with session_scope() as session:
        # The repair's own predicate, read from the database, against
        # `can_retry` applied row by row. They have to agree.
        counted = dict(
            session.execute(
                _select(BackgroundJob.status, func.count())
                .where(
                    BackgroundJob.attempt < BackgroundJob.max_attempts,
                    BackgroundJob.kind.notin_(tuple(service.NOT_OURS_TO_RETRY)),
                )
                .group_by(BackgroundJob.status)
            ).all()
        )
        rows = session.scalars(_select(BackgroundJob)).all()

    by_status: dict[str, int] = {}
    for row in rows:
        if service.can_retry(row):
            by_status[row.status] = by_status.get(row.status, 0) + 1

    # Compared only where retrying is possible at all. The repair's predicate
    # deliberately omits the terminal check — for QUEUED it means "not spent",
    # and demanding retryable QUEUED jobs would be a top-up that never ends —
    # so the two rules coincide exactly on `JOB_TERMINAL`, which is where the
    # guard reads them.
    terminal = {
        status: count
        for status, count in counted.items()
        if count and status in vocabulary.JOB_TERMINAL
    }
    assert terminal == by_status
    assert runner.sync_jobs is not None, "the repair this test is about"
