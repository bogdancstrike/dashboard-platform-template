"""The background job queue (§23). — retrying."""

from __future__ import annotations

from sqlalchemy import select

from src.core import vocabulary
from src.core.db import session_scope
from src.services.platform import jobs as service
from tests.jobs_support import (  # noqa: F401
    JOBS,
    _authenticate,
    _job,
    _read,
    pytestmark,
)


def test_a_retry_is_the_same_row_with_the_next_attempt(client, monkeypatch):
    """Not a new job: `attempt 2 of 3` is the fact an operator needs, and a
    fresh row per retry would lose the connection between them and count one
    failure as three."""
    headers = _authenticate(monkeypatch)
    job_id = _job(status="FAILED", attempt=1)

    answer = client.post(f"{JOBS}/{job_id}/retry", headers=headers)
    assert answer.status_code == 200, answer.get_json()
    body = answer.get_json()

    assert body["id"] == job_id, "a retry created a new job instead of re-queueing this one"
    assert body["attempt"] == 2
    assert body["status"] == "QUEUED"
    # The outcome of the failed attempt is cleared, or the row would read as
    # both queued and failed at once.
    assert body["error_message"] is None
    assert body["progress"] == 0
    assert body["finished_at"] is None


def test_a_retry_keeps_the_previous_attempts_log_lines(client, monkeypatch):
    """They are the evidence of *why* this retry exists — a queue that wiped
    them on retry would answer "it failed" and never "it failed because"."""
    headers = _authenticate(monkeypatch)
    job_id = _job(
        status="FAILED",
        log_lines=[{"at": None, "level": "ERROR", "message": "the upstream refused"}],
    )
    client.post(f"{JOBS}/{job_id}/retry", headers=headers)
    detail = _read(client, headers, job_id)

    messages = [line["message"] for line in detail["log_lines"]]
    assert "the upstream refused" in messages
    assert any("attempt 2 queued" in message for message in messages)


def test_a_running_job_is_refused_with_the_reason(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    job_id = _job(status="RUNNING")

    answer = client.post(f"{JOBS}/{job_id}/retry", headers=headers)
    assert answer.status_code == 409
    body = answer.get_json()
    assert "twice" in body["message"]
    assert body["details"]["retryable_from"] == list(vocabulary.JOB_TERMINAL)


def test_a_job_out_of_attempts_is_refused_with_the_bound_named(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    job_id = _job(status="FAILED", attempt=3, max_attempts=3)

    answer = client.post(f"{JOBS}/{job_id}/retry", headers=headers)
    assert answer.status_code == 409
    body = answer.get_json()
    assert "all 3" in body["message"]
    assert body["details"]["attempt"] == 3
    assert body["details"]["max_attempts"] == 3
    # And it names the ceiling it could be raised to, so the advice in the
    # message points at something the product actually offers.
    assert body["details"]["may_grant_up_to"] == service.MAX_ALLOWED_ATTEMPTS


def test_a_retry_is_audited_with_the_attempt_it_queued(client, monkeypatch):
    """A queue console that re-runs work against real rows and leaves no trace
    is one nobody can be held to."""
    headers = _authenticate(monkeypatch)
    job_id = _job(status="FAILED")
    client.post(f"{JOBS}/{job_id}/retry", headers=headers)

    from src.models.platform import AuditLog

    with session_scope() as session:
        row = session.scalar(
            select(AuditLog)
            .where(
                AuditLog.resource_type == "background_job",
                # A string column, not a UUID one: the ledger records what a
                # resource *was called*, across tables whose keys differ.
                AuditLog.resource_id == job_id,
            )
            .order_by(AuditLog.occurred_at.desc())
        )
    assert row is not None
    assert "attempt 2" in row.message
    assert row.state_before["attempt"] == 1
    assert row.state_after["attempt"] == 2


def test_a_cancel_keeps_the_row(client, monkeypatch):
    """A queue whose cancelled jobs vanish cannot answer "why did the nightly
    export not run last Tuesday", which is the question it gets asked."""
    headers = _authenticate(monkeypatch)
    job_id = _job(status="RUNNING", error_message=None)

    answer = client.post(f"{JOBS}/{job_id}/cancel", headers=headers)
    assert answer.status_code == 200
    body = answer.get_json()
    assert body["status"] == "CANCELLED"
    assert body["finished_at"] is not None
    # Still there, and still readable.
    assert _read(client, headers, job_id)["status"] == "CANCELLED"


def test_cancelling_records_who_stopped_it(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    job_id = _job(status="RUNNING")
    client.post(f"{JOBS}/{job_id}/cancel", headers=headers)

    detail = _read(client, headers, job_id)
    assert any("cancelled by" in line["message"] for line in detail["log_lines"])


def test_a_cancelled_job_measures_how_long_it_ran(client, monkeypatch):
    """A cancelled job with no duration reads as one that never started, which
    is a different thing from one somebody stopped."""
    headers = _authenticate(monkeypatch)
    job_id = _job(status="RUNNING", duration_ms=None)
    body = client.post(f"{JOBS}/{job_id}/cancel", headers=headers).get_json()
    assert body["duration_ms"] is not None
    assert body["duration_ms"] >= 0


def test_a_finished_job_cannot_be_cancelled_through_the_api(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    job_id = _job(status="SUCCEEDED")

    answer = client.post(f"{JOBS}/{job_id}/cancel", headers=headers)
    assert answer.status_code == 409
    assert "nothing left to stop" in answer.get_json()["message"]


def test_a_queued_job_can_be_cancelled_before_it_starts(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    job_id = _job(status="QUEUED", started_at=None, duration_ms=None)
    body = client.post(f"{JOBS}/{job_id}/cancel", headers=headers).get_json()
    assert body["status"] == "CANCELLED"
    # Never started, so there is no duration to invent.
    assert body["duration_ms"] is None
