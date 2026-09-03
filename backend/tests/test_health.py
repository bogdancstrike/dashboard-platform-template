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


def test_readiness_refuses_traffic_without_a_database(client):
    response = client.get(f"{PREFIX}/health/ready")
    assert response.status_code == 503
    body = response.get_json()
    assert body["status"] == "not_ready"
    assert body["checks"]["database"]["status"] == "unavailable"
    assert "error" in body["checks"]["database"]


def test_readiness_does_not_fail_on_a_disabled_cache(client):
    """The cache is an optimisation (`core/cache.py`), never a dependency."""
    body = client.get(f"{PREFIX}/health/ready").get_json()
    assert body["checks"]["cache"]["status"] == "disabled"


def test_snapshot_reports_each_dependency(client):
    response = client.get(f"{PREFIX}/health/status")
    body = response.get_json()
    assert set(body["checks"]) == {"database", "cache", "identity"}
    assert body["status"] == "unhealthy"
    assert response.status_code == 503
    assert "database" in body["degraded"]


def test_snapshot_leaks_no_configuration(client):
    """It is public, so it must carry status and latency and nothing else."""
    raw = client.get(f"{PREFIX}/health/status").get_data(as_text=True)
    for secret in (Config.DATABASE_URL, Config.SECRET_KEY, Config.REDIS_URL):
        assert secret not in raw
