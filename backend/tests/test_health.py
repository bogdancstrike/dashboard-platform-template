"""Health endpoints, and the codes an orchestrator actually reads."""

from __future__ import annotations

import pytest

from src.config import Config

PREFIX = Config.API_PREFIX


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
