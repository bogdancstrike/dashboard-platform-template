"""The background job queue (§23).

The claims worth asserting are the ones that decide whether a queue console can
be trusted to *act* rather than only to watch:

  * a **running** job cannot be retried, because retrying it would put two runs
    on the same rows — the commonest way a console corrupts what it supervises;
  * `max_attempts` is a real bound, refused with the number named, not a field
    the model declares and nothing enforces;
  * a retry is **the same row**, so `attempt 3 of 3` stays a fact and one
    failure is not counted as three;
  * a cancel **keeps the row**, because a queue whose cancelled jobs vanish
    cannot answer "why did the nightly export not run last Tuesday";
  * the refusal's advice is **something the product can do**: `allow_attempts`
    grants a spent job more, bounded, audited, and only upward;
  * `can_retry`/`can_cancel` on every row are the *server's* answer, so a
    button the page draws is a button the endpoint honours;
  * and every declared status is offered as a filter even at nought, since one
    that appeared only when something broke is one people stop looking for.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select

from src.config import Config
from src.core import vocabulary
from src.core.clock import now
from src.core.db import session_scope
from src.services import jobs as service
from tests.conftest import persona_claims

pytestmark = pytest.mark.database

PREFIX = Config.API_PREFIX
JOBS = f"{PREFIX}/admin/jobs"


def _authenticate(monkeypatch, username: str = "admin", role: str = "administrator"):
    monkeypatch.setattr(
        "src.core.auth.verify_token",
        lambda _token: persona_claims(username, role, sid=f"job-{username}"),
    )
    return {"Authorization": f"Bearer job-{username}"}


def _job(**overrides) -> str:
    """One job of this test's own, so nothing here edits a seeded row."""
    from src.core.clock import now
    from src.models.platform import BackgroundJob

    row = {
        "reference": f"JOB-T{uuid.uuid4().hex[:8]}",
        "name": "Report — projects",
        # Not EXPORT: this console does not retry those (§30), so a fixture of
        # that kind would test the refusal rather than the retry. The export
        # refusal has its own test below.
        "kind": "REPORT",
        "queue": "default",
        "status": "FAILED",
        "priority": "NORMAL",
        "progress": 40,
        "total_units": 100,
        "processed_units": 40,
        "failed_units": 60,
        "attempt": 1,
        "max_attempts": 3,
        "started_at": now(),
        "error_message": "Upstream timed out after 30s",
        "log_lines": [{"at": None, "level": "ERROR", "message": "it broke"}],
    }
    row.update(overrides)
    with session_scope() as session:
        job = BackgroundJob(**row)
        session.add(job)
        session.flush()
        return str(job.id)


def _read(client, headers, job_id: str) -> dict:
    answer = client.get(f"{JOBS}/{job_id}", headers=headers)
    assert answer.status_code == 200, answer.get_json()
    return answer.get_json()


# ── the two rules, stated exactly ────────────────────────────────────────


class _Row:
    """The four fields `can_retry` and `can_cancel` read, and nothing else."""

    def __init__(
        self,
        status: str,
        attempt: int = 1,
        max_attempts: int = 3,
        kind: str = "REPORT",
    ):
        self.status = status
        self.attempt = attempt
        self.max_attempts = max_attempts
        # A kind this console owns, so these cases test the status and attempt
        # rules rather than the kind rule (§30). The kind rule has its own
        # parametrised case below.
        self.kind = kind


@pytest.mark.parametrize("kind", sorted(service.NOT_OURS_TO_RETRY))
def test_a_kind_another_screen_owns_is_never_retryable_here(kind):
    # Terminal and within its attempts, so the kind is the only thing left to
    # refuse it — which is the point.
    assert service.can_retry(_Row("CANCELLED", kind=kind)) is False


@pytest.mark.parametrize("status", vocabulary.JOB_TERMINAL)
def test_a_finished_job_can_be_retried(status):
    assert service.can_retry(_Row(status)) is True


@pytest.mark.parametrize(
    "status", [s for s in vocabulary.JOB_STATUS if s not in vocabulary.JOB_TERMINAL]
)
def test_an_unfinished_job_cannot_be_retried(status):
    """Retrying a job that is still going puts two runs on the same rows, which
    is the commonest way a queue console corrupts what it supervises."""
    assert service.can_retry(_Row(status)) is False


def test_a_job_that_has_used_its_attempts_cannot_be_retried():
    """Otherwise `max_attempts` is a column the model declares and nothing
    enforces — and a three-attempt limit that allows a fourth is worse than no
    limit, because somebody is relying on it."""
    assert service.can_retry(_Row("FAILED", attempt=3, max_attempts=3)) is False
    assert service.can_retry(_Row("FAILED", attempt=2, max_attempts=3)) is True
    assert service.can_retry(_Row("FAILED", attempt=4, max_attempts=3)) is False


@pytest.mark.parametrize("status", vocabulary.JOB_CANCELLABLE)
def test_an_unfinished_job_can_be_cancelled(status):
    assert service.can_cancel(_Row(status)) is True


@pytest.mark.parametrize("status", vocabulary.JOB_TERMINAL)
def test_a_finished_job_cannot_be_cancelled(status):
    """There is nothing left to stop, and a Cancel that "succeeded" on a job
    that finished last Tuesday would rewrite history."""
    assert service.can_cancel(_Row(status)) is False


def test_the_two_state_sets_cover_every_status_between_them():
    """A status in neither could be neither retried nor cancelled, which is a
    row the console can only stare at — and one in *both* would offer two
    contradictory actions at once."""
    terminal = set(vocabulary.JOB_TERMINAL)
    cancellable = set(vocabulary.JOB_CANCELLABLE)
    assert terminal | cancellable == set(vocabulary.JOB_STATUS)
    assert not terminal & cancellable


# ── the listing ──────────────────────────────────────────────────────────


def test_every_row_carries_the_servers_answer_about_what_may_be_done(client, monkeypatch):
    """So a button the page draws is a button the endpoint honours. A browser
    re-deriving these rules would eventually disagree with the server that
    enforces them."""
    headers = _authenticate(monkeypatch)
    answer = client.get(f"{JOBS}?page_size=50", headers=headers).get_json()

    assert answer["items"], "the seed should carry jobs"
    for row in answer["items"]:
        # The rule restated here rather than imported, so a change to
        # `can_retry` has to be a deliberate change to this line too — all
        # three clauses, including the kind this console does not own (§30).
        expected_retry = (
            row["kind"] not in service.NOT_OURS_TO_RETRY
            and row["status"] in vocabulary.JOB_TERMINAL
            and row["attempt"] < row["max_attempts"]
        )
        assert row["can_retry"] is expected_retry, row["reference"]
        assert row["can_cancel"] is (row["status"] in vocabulary.JOB_CANCELLABLE)


def test_the_catalogue_offers_every_status_even_at_nought(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    answer = client.get(f"{JOBS}/catalogue", headers=headers).get_json()
    assert [item["key"] for item in answer["statuses"]] == list(vocabulary.JOB_STATUS)


def test_the_seed_leaves_no_status_without_a_job(client, monkeypatch):
    """`/admin/jobs` builds its filters from `JOB_STATUS`, and RETRYING is
    weighted at 0.04 — so at the small scale the draw leaves it empty about
    half the time and the console offers a filter that can never match
    anything (§76). The seed covers it now; `--sync-jobs` repairs a database
    seeded before it did."""
    headers = _authenticate(monkeypatch)
    answer = client.get(f"{JOBS}/catalogue", headers=headers).get_json()
    empty = [item["key"] for item in answer["statuses"] if item["count"] == 0]
    assert not empty, f"no job is {empty} — run 'make sync-jobs'"


def test_a_retrying_job_says_why_it_is_retrying(client, monkeypatch):
    """"Failed and will be tried again" versus "failed and will not" is the one
    distinction an operator reads this screen for, and the first version of the
    seed gave RETRYING no error at all."""
    headers = _authenticate(monkeypatch)
    answer = client.get(f"{JOBS}?status=RETRYING&page_size=10", headers=headers).get_json()
    assert answer["items"], "no retrying job to check"
    for row in answer["items"]:
        assert row["error_message"], row["reference"]
        assert row["attempt"] > 1, row["reference"]


def test_the_queue_is_faceted_from_the_data_not_a_hardcoded_list(client, monkeypatch):
    """A deployment adds queues, so `queue` cannot be a closed vocabulary —
    and a filter menu built from a literal list is one that stops matching the
    day somebody adds `reports`."""
    headers = _authenticate(monkeypatch)
    answer = client.get(f"{JOBS}?page_size=1", headers=headers).get_json()
    queues = {item["value"] for item in answer["facets"]["queue"]}
    assert len(queues) > 1


def test_the_listing_narrows_by_status(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    answer = client.get(f"{JOBS}?status=FAILED&page_size=50", headers=headers).get_json()
    assert answer["items"]
    assert {row["status"] for row in answer["items"]} == {"FAILED"}


# ── one job in full ──────────────────────────────────────────────────────


def test_a_jobs_detail_carries_its_payload_result_and_lines(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    job_id = _job(
        status="SUCCEEDED",
        progress=100,
        processed_units=100,
        failed_units=0,
        error_message=None,
        payload={"entity": "project", "format": "csv"},
        result={"rows": 100, "artifact": "exports/x.csv"},
    )
    detail = _read(client, headers, job_id)

    assert detail["payload"]["format"] == "csv"
    assert detail["result"]["rows"] == 100
    assert detail["log_lines"]
    assert detail["log_truncated"] is False


def test_a_runaway_jobs_lines_are_capped(client, monkeypatch):
    """A drawer is not a log viewer — `/admin/logs` is — and a job that logged
    ten thousand lines would otherwise *be* the response."""
    headers = _authenticate(monkeypatch)
    job_id = _job(
        log_lines=[{"at": None, "level": "INFO", "message": f"line {n}"} for n in range(400)]
    )
    detail = _read(client, headers, job_id)

    assert len(detail["log_lines"]) == service.MAX_LOG_LINES
    # And it says so, rather than quietly showing a prefix.
    assert detail["log_truncated"] is True


def test_a_job_that_does_not_exist_says_so(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    assert client.get(f"{JOBS}/{uuid.uuid4()}", headers=headers).status_code == 404


def test_an_id_that_is_not_a_uuid_names_the_field(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    answer = client.get(f"{JOBS}/not-a-uuid", headers=headers)
    assert answer.status_code == 400
    assert "id" in answer.get_json()["message"]


# ── retrying ─────────────────────────────────────────────────────────────


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


# ── cancelling ───────────────────────────────────────────────────────────


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


# ── permissions ──────────────────────────────────────────────────────────


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


# ── granting more attempts ───────────────────────────────────────────────


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


# ── the kinds this console does not own ─────────────────────────────────


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
    from src.services.jobs import NOT_OURS_TO_RETRY

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
    from sqlalchemy import func, select as _select

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
