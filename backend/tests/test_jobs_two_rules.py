"""The background job queue (§23). — the two rules, stated exactly."""

from __future__ import annotations

import uuid

import pytest

from src.core import vocabulary
from src.services.platform import jobs as service
from tests.jobs_support import (  # noqa: F401
    JOBS,
    _authenticate,
    _job,
    _read,
    _Row,
    pytestmark,
)


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
