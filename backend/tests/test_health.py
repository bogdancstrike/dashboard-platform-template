"""Health endpoints, and the codes an orchestrator actually reads."""

from __future__ import annotations

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


def test_readiness_does_not_fail_on_a_disabled_cache(client):
    """The cache is an optimisation (`core/cache.py`), never a dependency."""
    body = client.get(f"{PREFIX}/health/ready").get_json()
    assert body["checks"]["cache"]["status"] == "disabled"


def test_snapshot_reports_each_dependency(client, has_database):
    response = client.get(f"{PREFIX}/health/status")
    body = response.get_json()
    assert set(body["checks"]) == {"database", "cache", "identity"}
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


def test_snapshot_leaks_no_configuration(client):
    """It is public, so it must carry status and latency and nothing else."""
    raw = client.get(f"{PREFIX}/health/status").get_data(as_text=True)
    for secret in (Config.DATABASE_URL, Config.SECRET_KEY, Config.REDIS_URL):
        assert secret not in raw
