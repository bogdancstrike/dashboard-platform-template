"""Health endpoints, and the codes an orchestrator actually reads."""

from __future__ import annotations

import pytest

from src.config import Config
from tests.conftest import persona_claims

PREFIX = Config.API_PREFIX


def _authenticate(monkeypatch, username: str = "admin", role: str = "administrator"):
    monkeypatch.setattr(
        "src.core.auth.verify_token",
        lambda token: persona_claims(
            str(token).split("-")[1], str(token).split("-")[2], sid=f"health-{username}"
        ),
    )
    return {"Authorization": f"Bearer health-{username}-{role}"}


def test_liveness_never_touches_a_dependency(client):
    """Answers 200 with every dependency refused, which is the whole point:
    a liveness probe that fails on a database blip restarts a healthy API."""
    response = client.get(f"{PREFIX}/health/live")
    assert response.status_code == 200
    body = response.get_json()
    assert body["status"] == "healthy"
    assert body["uptime_seconds"] >= 0
    assert body["started_at"].endswith("Z")


def test_readiness_follows_the_database(client, has_database):
    """Readiness is exactly "can the database answer".

    Both directions matter, so the assertion follows the environment rather
    than assuming one: with `TEST_DATABASE_URL` set there is a database and the
    probe must pass; without one it must refuse traffic rather than let an
    orchestrator route into a process that cannot serve.
    """
    response = client.get(f"{PREFIX}/health/ready")
    body = response.get_json()
    if has_database:
        assert response.status_code == 200
        assert body["status"] == "ready"
        assert body["checks"]["database"]["status"] == "healthy"
        assert body["checks"]["database"]["latency_ms"] >= 0
    else:
        assert response.status_code == 503
        assert body["status"] == "not_ready"
        assert body["checks"]["database"]["status"] == "unavailable"
        assert "error" in body["checks"]["database"]


@pytest.mark.parametrize(
    ("enabled", "expected"), [(False, "disabled"), (True, "unavailable")]
)
def test_readiness_does_not_fail_on_a_cache_that_is_not_there(
    client, monkeypatch, enabled, expected
):
    """The cache is an optimisation (`core/cache.py`), never a dependency.

    Both states are arranged rather than inherited from the suite's own
    configuration. This test used to assert "disabled" and pass only because
    the suite happened to switch caching off; the day a `TEST_REDIS_URL` turned
    it on, the test failed while the product was fine — and the case that
    actually matters in production, an *enabled* cache that cannot be reached,
    was never covered at all.
    """
    from src.core import cache
    from src.config import Config

    monkeypatch.setattr(Config, "CACHE_ENABLED", enabled)
    monkeypatch.setattr(cache, "client", lambda: None)

    response = client.get(f"{PREFIX}/health/ready")
    body = response.get_json()
    assert body["checks"]["cache"]["status"] == expected
    # Ready either way: a readiness probe that fails on a missing cache takes
    # the whole deployment out for an optimisation.
    assert "cache" not in body.get("degraded", [])


def test_snapshot_reports_each_dependency(client, has_database):
    response = client.get(f"{PREFIX}/health/status")
    body = response.get_json()
    assert set(body["checks"]) == {"database", "cache", "storage", "identity"}
    # Which store is answering, not only whether it is: the local fallback
    # streams every byte through this process, and a deployment running on it
    # by accident should be able to see that from the health page (§24).
    assert body["checks"]["storage"]["store"] in ("object", "local")
    # Keycloak is unreachable in the suite either way, so the snapshot is never
    # fully healthy here — but only the database is fatal.
    assert "identity" in body["degraded"]
    if has_database:
        assert body["status"] == "degraded"
        assert response.status_code == 200
        assert "database" not in body["degraded"]
    else:
        assert body["status"] == "unhealthy"
        assert response.status_code == 503
        assert "database" in body["degraded"]


def test_the_snapshot_names_the_store_even_when_it_cannot_be_reached(client, monkeypatch):
    """"unavailable" alone tells an operator nothing about where to look.

    Found by running the suite without the storage environment: the local
    fallback's directory was unwritable, the probe fell into its `except`, and
    the snapshot dropped the one field that says *which* store had failed.
    """
    from src.core import storage
    from src.services import health

    monkeypatch.setattr(
        storage, "for_config", lambda **_kwargs: (_ for _ in ()).throw(OSError("no such directory"))
    )
    reported = health.probe_storage()

    assert reported["status"] == "unavailable"
    assert reported["store"] in ("object", "local")
    assert "no such directory" in reported["error"]


def test_snapshot_leaks_no_configuration(client):
    """It is public, so it must carry status and latency and nothing else."""
    raw = client.get(f"{PREFIX}/health/status").get_data(as_text=True)
    for secret in (Config.DATABASE_URL, Config.SECRET_KEY, Config.REDIS_URL):
        assert secret not in raw


@pytest.mark.database
def test_the_history_says_what_each_service_was_doing(client, monkeypatch):
    """The snapshot answers "is it working now"; this answers "was it" (§24).

    A page that can only report the present cannot answer the question people
    are actually on it for — *was the platform part of what happened at four
    o'clock* — and the incident is then reconstructed from memory. The history
    was already recorded on `service_health.history`; nothing served it.
    """
    headers = _authenticate(monkeypatch, "admin", "administrator")
    body = client.get(
        f"{PREFIX}/health/history?period=7d", headers=headers
    ).get_json()

    assert body["period"] == "7d"
    assert body["periods"] == ["8h", "1d", "7d", "30d"]
    assert body["services"], "the seed monitors at least one service"

    service = body["services"][0]
    assert service["series"], "a window of a week has readings in it"
    # Bucketed rather than truncated: dropping the end of a window answers a
    # different question from the one that was asked.
    assert len(service["series"]) <= 180
    # Two uptime figures, and they are different questions: one is the row's
    # lifetime, one is the window on screen.
    assert "uptime_percent" in service
    assert 0 <= service["window_uptime_percent"] <= 100

    # An outage is a period, not a run of points: consecutive not-healthy
    # readings collapse, so a three-hour outage is one incident and not three.
    for incident in service["incidents"]:
        assert incident["status"] != "HEALTHY"
        assert incident["started_at"] <= incident["ended_at"]


@pytest.mark.database
def test_a_history_needs_a_permission_where_the_probes_do_not(client, monkeypatch):
    """The probes are polled by things that hold no token; this is not one.

    A history is a record of when the platform was broken — operational
    detail rather than a liveness signal — so it is the one health endpoint
    behind `health.view`.
    """
    assert client.get(f"{PREFIX}/health/status").status_code in (200, 503)
    assert client.get(f"{PREFIX}/health/history").status_code == 401

    # But not an administrators-only page: `health.view` is a permission every
    # built-in role carries, because "is the platform all right" is a question
    # anybody using it is entitled to ask. What the token buys is the *record*
    # of when it was not.
    headers = _authenticate(monkeypatch, "user", "viewer")
    assert client.get(f"{PREFIX}/health/history", headers=headers).status_code == 200


@pytest.mark.database
def test_an_unreadable_window_falls_back_rather_than_refusing(client, monkeypatch):
    """A health page that answers a malformed query with a 400 is a health page
    somebody cannot use during the incident it exists for."""
    headers = _authenticate(monkeypatch, "admin", "administrator")
    body = client.get(
        f"{PREFIX}/health/history?period=fortnight&from=not-a-date", headers=headers
    ).get_json()
    assert body["period"] == "1d"
