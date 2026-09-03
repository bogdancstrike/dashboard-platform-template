"""Dependency probes behind the health endpoints and the system-health page.

Three levels, because three different callers ask three different questions:

* **liveness** — is this process running? No I/O at all. A liveness probe that
  touches the database restarts a healthy API every time the database hiccups,
  which turns a brief outage into a crash loop.
* **readiness** — can this process serve a request? The database must answer;
  the cache must not, because `core/cache.py` degrades to a miss by design.
* **snapshot** — everything, with latency and last error, for §24.
"""

from __future__ import annotations

import os
import platform
import socket
import time
from typing import Any

from src.config import Config
from src.core.clock import iso, now

#: Wall-clock at import, which is process start for every practical purpose.
_STARTED_AT = now()
_STARTED_MONOTONIC = time.monotonic()


def uptime_seconds() -> float:
    return round(time.monotonic() - _STARTED_MONOTONIC, 3)


def liveness() -> dict[str, Any]:
    return {
        "status": "healthy",
        "service": Config.SERVICE_NAME,
        "environment": Config.ENVIRONMENT,
        "started_at": iso(_STARTED_AT),
        "uptime_seconds": uptime_seconds(),
        "checked_at": iso(now()),
    }


def probe_database() -> dict[str, Any]:
    """`SELECT 1` plus the pool's own accounting.

    The pool numbers are the useful half: a database that answers in 2ms while
    every connection is checked out is a database about to look very slow.
    """
    from sqlalchemy import text

    from src.core.db import get_engine

    started = time.perf_counter()
    try:
        engine = get_engine()
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        latency = round((time.perf_counter() - started) * 1000, 2)
        pool = engine.pool
        detail: dict[str, Any] = {"status": "healthy", "latency_ms": latency}
        # Not every pool implementation carries these (NullPool in tests).
        for name in ("size", "checkedin", "checkedout", "overflow"):
            probe = getattr(pool, name, None)
            if callable(probe):
                try:
                    detail[f"pool_{name}"] = probe()
                except Exception:  # pragma: no cover - diagnostics only
                    pass
        return detail
    except Exception as exc:
        return {
            "status": "unavailable",
            "latency_ms": round((time.perf_counter() - started) * 1000, 2),
            "error": str(exc)[:300],
        }


def probe_cache() -> dict[str, Any]:
    from src.core import cache

    return cache.health()


def probe_auth() -> dict[str, Any]:
    """Reaches Keycloak for the realm keys, so it is deliberately not part of
    readiness: the API serves cached-key traffic perfectly well while the
    identity provider restarts."""
    from src.core.auth import auth_health

    return auth_health()


def readiness() -> tuple[dict[str, Any], bool]:
    """The report, and whether the process should accept traffic."""
    database = probe_database()
    cache_state = probe_cache()
    ready = database["status"] == "healthy"
    return (
        {
            "status": "ready" if ready else "not_ready",
            "service": Config.SERVICE_NAME,
            "environment": Config.ENVIRONMENT,
            "uptime_seconds": uptime_seconds(),
            "checked_at": iso(now()),
            "checks": {
                "database": database,
                # Reported so a degraded cache is visible, but never fatal.
                "cache": cache_state,
            },
        },
        ready,
    )


def snapshot(*, include_auth: bool = True) -> dict[str, Any]:
    """Everything §24 renders: each dependency, plus who is reporting it."""
    checks = {"database": probe_database(), "cache": probe_cache()}
    if include_auth:
        checks["identity"] = probe_auth()

    degraded = [name for name, state in checks.items() if state.get("status") == "unavailable"]
    critical = "database" in degraded
    return {
        "status": "unhealthy" if critical else "degraded" if degraded else "healthy",
        "degraded": degraded,
        "service": Config.SERVICE_NAME,
        "environment": Config.ENVIRONMENT,
        "version": Config.APP_VERSION,
        "host": socket.gethostname(),
        "pid": os.getpid(),
        "python": platform.python_version(),
        "started_at": iso(_STARTED_AT),
        "uptime_seconds": uptime_seconds(),
        "checked_at": iso(now()),
        "checks": checks,
    }
