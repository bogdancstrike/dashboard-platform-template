"""The background job queue (§23). — permissions."""

from __future__ import annotations

from sqlalchemy import select

from src.core.db import session_scope
from src.services.platform import jobs as service
from tests.jobs_support import (  # noqa: F401
    JOBS,
    _authenticate,
    _job,
    _read,
    _Row,
    pytestmark,
)


def test_reading_the_queue_needs_jobs_view(client, monkeypatch):
    headers = _authenticate(monkeypatch, "user", "viewer")
    assert client.get(JOBS, headers=headers).status_code == 403
    assert client.get(f"{JOBS}/catalogue", headers=headers).status_code == 403


def test_acting_on_it_needs_jobs_manage(client, monkeypatch):
    """An analyst holds `jobs.view` and not `jobs.manage`: watching a queue and
    re-running work against real rows are different privileges."""
    job_id = _job(status="FAILED")
    headers = _authenticate(monkeypatch, "analyst", "analyst")

    assert client.get(JOBS, headers=headers).status_code == 200
    assert client.post(f"{JOBS}/{job_id}/retry", headers=headers).status_code == 403
    assert client.post(f"{JOBS}/{job_id}/cancel", headers=headers).status_code == 403


def test_the_catalogue_tells_the_reader_whether_they_may_act(client, monkeypatch):
    """So the page decides once, rather than drawing controls it will have to
    take away per row."""
    admin = _authenticate(monkeypatch, "admin", "administrator")
    assert client.get(f"{JOBS}/catalogue", headers=admin).get_json()["can_manage"] is True

    analyst = _authenticate(monkeypatch, "analyst", "analyst")
    assert client.get(f"{JOBS}/catalogue", headers=analyst).get_json()["can_manage"] is False


def test_the_control_is_offered_exactly_where_the_refusal_points():
    """Offered only where it changes something: a job with attempts to spare
    does not need more, and one at the ceiling cannot have them."""
    assert service.can_allow_attempts(_Row("FAILED", attempt=1, max_attempts=3)) is False
    assert service.can_allow_attempts(_Row("FAILED", attempt=3, max_attempts=3)) is True
    assert (
        service.can_allow_attempts(
            _Row("FAILED", attempt=service.MAX_ALLOWED_ATTEMPTS,
                 max_attempts=service.MAX_ALLOWED_ATTEMPTS)
        )
        is False
    )


def test_a_spent_job_can_be_granted_more_and_then_retried(client, monkeypatch):
    """The whole point. Before this, the refusal told an operator to raise a
    limit the product gave them no way to raise — an error message naming a fix
    that does not exist."""
    headers = _authenticate(monkeypatch)
    job_id = _job(status="FAILED", attempt=3, max_attempts=3)

    # Refused, and the refusal now names something that exists.
    refused = client.post(f"{JOBS}/{job_id}/retry", headers=headers)
    assert refused.status_code == 409
    assert refused.get_json()["details"]["may_grant_up_to"] == service.MAX_ALLOWED_ATTEMPTS

    granted = client.put(
        f"{JOBS}/{job_id}/attempts", headers=headers, json={"max_attempts": 5}
    )
    assert granted.status_code == 200, granted.get_json()
    assert granted.get_json()["max_attempts"] == 5
    assert granted.get_json()["can_retry"] is True

    # And now it runs.
    assert client.post(f"{JOBS}/{job_id}/retry", headers=headers).status_code == 200


def test_the_grant_only_goes_up(client, monkeypatch):
    """Lowering it below the attempts already spent would make "attempt 4 of 3"
    a state the console would have to explain, and an operator gains nothing."""
    headers = _authenticate(monkeypatch)
    job_id = _job(status="FAILED", attempt=3, max_attempts=3)

    answer = client.put(f"{JOBS}/{job_id}/attempts", headers=headers, json={"max_attempts": 2})
    assert answer.status_code == 400
    assert "does not take any away" in answer.get_json()["message"]
    # And the same number is not a grant either.
    same = client.put(f"{JOBS}/{job_id}/attempts", headers=headers, json={"max_attempts": 3})
    assert same.status_code == 400


def test_the_grant_has_a_ceiling(client, monkeypatch):
    """"Retry until it works" is how a broken job writes the same rows forty
    times."""
    headers = _authenticate(monkeypatch)
    job_id = _job(status="FAILED", attempt=3, max_attempts=3)

    answer = client.put(f"{JOBS}/{job_id}/attempts", headers=headers, json={"max_attempts": 99})
    assert answer.status_code == 400
    assert answer.get_json()["details"]["maximum"] == service.MAX_ALLOWED_ATTEMPTS
    # The ceiling itself is allowed.
    assert (
        client.put(
            f"{JOBS}/{job_id}/attempts",
            headers=headers,
            json={"max_attempts": service.MAX_ALLOWED_ATTEMPTS},
        ).status_code
        == 200
    )


def test_a_grant_that_is_not_a_number_says_so(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    job_id = _job(status="FAILED", attempt=3, max_attempts=3)
    answer = client.put(
        f"{JOBS}/{job_id}/attempts", headers=headers, json={"max_attempts": "lots"}
    )
    assert answer.status_code == 400
    assert "whole number" in answer.get_json()["message"]


def test_a_grant_is_audited_and_recorded_on_the_job(client, monkeypatch):
    """Raising a retry limit is a decision somebody made about real work, so it
    leaves a trace in both places an operator would look."""
    headers = _authenticate(monkeypatch)
    job_id = _job(status="FAILED", attempt=3, max_attempts=3)
    client.put(f"{JOBS}/{job_id}/attempts", headers=headers, json={"max_attempts": 5})

    detail = _read(client, headers, job_id)
    assert any("limit raised to 5" in line["message"] for line in detail["log_lines"])

    from src.models.platform import AuditLog

    with session_scope() as session:
        row = session.scalar(
            select(AuditLog)
            .where(
                AuditLog.resource_type == "background_job",
                AuditLog.resource_id == job_id,
            )
            .order_by(AuditLog.occurred_at.desc())
        )
    assert row is not None
    assert row.state_before["max_attempts"] == 3
    assert row.state_after["max_attempts"] == 5


def test_granting_needs_jobs_manage(client, monkeypatch):
    job_id = _job(status="FAILED", attempt=3, max_attempts=3)
    headers = _authenticate(monkeypatch, "analyst", "analyst")
    answer = client.put(f"{JOBS}/{job_id}/attempts", headers=headers, json={"max_attempts": 5})
    assert answer.status_code == 403
