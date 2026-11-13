"""Dependency probes behind the health endpoints and the system-health page.
See docs/architecture/backend/health.md."""

from __future__ import annotations

from src.core.facade import lazy

__getattr__, __dir__, __all__ = lazy(__name__, {
    "probes": (
        "_STARTED_AT", "_STARTED_MONOTONIC", "uptime_seconds", "liveness", "probe_database",
        "probe_cache", "probe_storage", "probe_auth", "readiness", "snapshot",
    ),
    "history_view": (
        "PERIODS", "MAX_POINTS", "history", "_window", "_moment", "_service_history", "_bucket",
        "_RANK",
    ),
    "incidents": ("_incidents", "_uptime"),
})
