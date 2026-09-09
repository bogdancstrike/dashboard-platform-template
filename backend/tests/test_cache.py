"""Redis caches the expensive aggregates, and the writes invalidate them.

Two halves, because each is wrong on its own.

**The mechanism**, against a real Redis: a generation per dataset, stamped into
the cache key, bumped by a write. Marked `cache` and skipped without
`TEST_REDIS_URL`, the same shape as the database marker — a suite that must run
on a laptop with nothing installed cannot require a cache, and a cache that is
switched off cannot be asserted.

**The claim a reader depends on**, against a real Redis *and* a real database:
that closing a ticket changes the number above the table. That is the whole
reason this is generational rather than a TTL. A dashboard behind a five-minute
timer tells the person who just made the change that it did not happen, and
they are the one person guaranteed to notice.
"""

from __future__ import annotations

import pytest

from src.config import Config
from src.core import cache
from tests.conftest import persona_claims

PREFIX = Config.API_PREFIX


def _authenticate(monkeypatch, username: str = "admin", role: str = "administrator"):
    monkeypatch.setattr(
        "src.core.auth.verify_token",
        lambda _token: persona_claims(username, role, sid=f"cache-{username}"),
    )
    return {"Authorization": f"Bearer cache-{username}"}


@pytest.fixture(autouse=True)
def clean_generations():
    """Leave the generations where they were found.

    The counters are shared with a running stack, and a test that reset them to
    nothing would make a *deployed* dashboard serve one stale answer. Bumping
    is harmless — it costs one recomputation — so these only ever go up.
    """
    yield


# ── the mechanism ────────────────────────────────────────────────────────


@pytest.mark.cache
def test_a_generation_starts_somewhere_and_only_moves_forward():
    before = cache.generations("ticket")["ticket"]
    cache.bump("ticket")
    after = cache.generations("ticket")["ticket"]
    # Forward, so a key naming the old value can never be reached again — and
    # never backward, which would resurrect an entry the write invalidated.
    assert after == before + 1


@pytest.mark.cache
def test_one_read_covers_every_dataset_an_aggregate_depends_on():
    # The dashboard depends on eight. Eight round trips to Redis is most of
    # what the cache was saving, so this is one `MGET`.
    found = cache.generations("ticket", "order", "task")
    assert set(found) == {"ticket", "order", "task"}
    assert all(isinstance(value, int) for value in found.values())


@pytest.mark.cache
def test_an_aggregate_is_computed_once_and_then_read():
    calls: list[int] = []

    def producer():
        calls.append(1)
        return {"total": 41}

    payload = {"marker": "cache-test-once"}
    first = cache.aggregate("test:agg", payload, depends_on=("ticket",), producer=producer)
    second = cache.aggregate("test:agg", payload, depends_on=("ticket",), producer=producer)

    assert first == second == {"total": 41}
    # Once. A read-through cache that recomputes on a hit is not a cache.
    assert len(calls) == 1


@pytest.mark.cache
def test_a_write_to_a_dataset_it_depends_on_makes_it_recompute():
    answers = iter([{"total": 1}, {"total": 2}])
    payload = {"marker": "cache-test-invalidate"}

    def producer():
        return next(answers)

    first = cache.aggregate("test:agg", payload, depends_on=("ticket",), producer=producer)
    cache.bump("ticket")
    second = cache.aggregate("test:agg", payload, depends_on=("ticket",), producer=producer)

    assert first == {"total": 1}
    # The old entry is not deleted — it is unreachable, which is what makes the
    # invalidation atomic. A scan-and-delete leaves a window in which a request
    # that read before the write stores its answer after it.
    assert second == {"total": 2}


@pytest.mark.cache
def test_a_write_to_a_dataset_it_does_not_depend_on_leaves_it_alone():
    calls: list[int] = []

    def producer():
        calls.append(1)
        return {"total": 7}

    payload = {"marker": "cache-test-unrelated"}
    cache.aggregate("test:agg", payload, depends_on=("ticket",), producer=producer)
    cache.bump("device")
    cache.aggregate("test:agg", payload, depends_on=("ticket",), producer=producer)

    # The other direction, and the one that rots quietly: a dependency set too
    # wide turns the cache into a slower database.
    assert len(calls) == 1


@pytest.mark.cache
def test_two_different_questions_do_not_share_an_entry():
    calls: list[dict] = []

    def producer():
        calls.append({})
        return {"total": len(calls)}

    one = cache.aggregate(
        "test:agg", {"marker": "cache-a"}, depends_on=("ticket",), producer=producer
    )
    two = cache.aggregate(
        "test:agg", {"marker": "cache-b"}, depends_on=("ticket",), producer=producer
    )
    assert one != two


def test_the_producer_runs_when_there_is_no_cache_at_all(monkeypatch):
    """The promise the module opens with, on the aggregate path too.

    Not marked `cache`: this is the *no Redis* case, which is the default for
    this suite and the case a laptop runs in.
    """
    monkeypatch.setattr(cache, "client", lambda: None)
    calls: list[int] = []

    def producer():
        calls.append(1)
        return {"total": 3}

    assert cache.aggregate("test:agg", {}, depends_on=("ticket",), producer=producer) == {
        "total": 3
    }
    assert cache.generations("ticket") == {"ticket": 0}
    # And bumping is a no-op rather than an error: a cache that cannot be
    # invalidated must not break the write that tried.
    cache.bump("ticket")
    assert len(calls) == 1


def test_generations_of_nothing_is_nothing():
    assert cache.generations() == {}


# ── the claim a reader depends on ────────────────────────────────────────


@pytest.mark.cache
@pytest.mark.database
def test_a_write_shows_up_in_the_dashboard_immediately(client, monkeypatch):
    """The number somebody just changed is the number they are checking.

    This is the whole argument for invalidating on writes rather than on a
    timer, and it is asserted end to end: read the overview, create a ticket,
    read it again. Behind a TTL the second read would be the first one's
    answer, and the reader would be told their own change had not happened.
    """
    headers = _authenticate(monkeypatch)
    # `/dashboard/summary` is in the bare namespace, not under `/api`.
    url = f"{PREFIX}/dashboard/summary?period=last_30_days"

    def open_tickets() -> float:
        response = client.get(url, headers=headers)
        assert response.status_code == 200, response.get_data(as_text=True)
        body = response.get_json()
        tile = next(kpi for kpi in body["kpis"] if kpi["key"] == "open_tickets")
        return float(tile["value"])

    before = open_tickets()
    # Cached now — the second read must be the same number, or there is nothing
    # to invalidate and this test proves nothing.
    assert open_tickets() == before

    created = client.post(
        f"{PREFIX}/api/records/ticket",
        json={
            "subject": "Cache invalidation probe",
            "description": "Created by the cache test.",
            "status": "OPEN",
            "priority": "NORMAL",
            "severity": "MINOR",
            "category": "SUPPORT",
            "channel": "EMAIL",
        },
        headers=headers,
    )
    assert created.status_code == 201, created.get_json()
    ticket_id = created.get_json()["id"]

    try:
        assert open_tickets() == before + 1
    finally:
        client.delete(f"{PREFIX}/api/records/ticket/{ticket_id}", headers=headers)

    # And the delete invalidates it too, which is the same mechanism and worth
    # asserting because a delete is the write most often forgotten.
    assert open_tickets() == before


@pytest.mark.cache
@pytest.mark.database
def test_a_dataset_summary_is_the_same_for_every_reader_who_may_see_it(client, monkeypatch):
    """Why the insights cache key carries no principal.

    The aggregate is not keyed on who is asking, on the grounds that
    `_base_statement` narrows by soft-deletion and nothing else. That is a
    claim about the query, so it is asserted: two personas, both holding
    `records.view`, get the same total. If a resource is ever scoped by
    organization or assignment, this fails — and the scope has to enter the
    cache key before it can pass again.
    """
    body = {"resource_type": "ticket", "columns": ["reference", "status"], "page_size": 5}

    _authenticate(monkeypatch, "admin", "administrator")
    as_admin = client.post(
        f"{PREFIX}/api/explorer/insights", json=body,
        headers={"Authorization": "Bearer cache-admin"},
    ).get_json()

    _authenticate(monkeypatch, "analyst", "analyst")
    as_analyst = client.post(
        f"{PREFIX}/api/explorer/insights", json=body,
        headers={"Authorization": "Bearer cache-analyst"},
    ).get_json()

    assert as_admin["total"] == as_analyst["total"]
    assert [metric["value"] for metric in as_admin["metrics"]] == [
        metric["value"] for metric in as_analyst["metrics"]
    ]


@pytest.mark.cache
@pytest.mark.database
def test_a_bad_query_is_a_bad_request_rather_than_a_cache_key(client, monkeypatch):
    # Validated before anything is cached: a payload naming a field that does
    # not exist has to fail, and a cache that answered it would fail *once* and
    # then succeed with nothing in it.
    headers = _authenticate(monkeypatch)
    refused = client.post(
        f"{PREFIX}/api/explorer/insights",
        json={"resource_type": "nonesuch"},
        headers=headers,
    )
    assert refused.status_code in (400, 404)
