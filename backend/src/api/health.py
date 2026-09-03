"""Health endpoints.

Handlers take QF's calling convention — `(app, operation, request, **params)` —
and return `(body, status)`. The status codes matter more than the bodies here:
an orchestrator reads the code, and a readiness probe that answers 200 while
the database is unreachable will happily route traffic into a broken process.
"""

from __future__ import annotations

from typing import Any

from src.services import health as probes


def liveness(app=None, operation: str = "", request=None, **_: Any):
    return probes.liveness(), 200


def readiness(app=None, operation: str = "", request=None, **_: Any):
    body, ready = probes.readiness()
    return body, 200 if ready else 503


def snapshot(app=None, operation: str = "", request=None, **_: Any):
    """Full dependency detail (§24).

    Public, and deliberately so: this is what a deploy pipeline and an uptime
    monitor poll, neither of which holds a token. It exposes service status and
    latency — never configuration, credentials or connection strings.
    """
    body = probes.snapshot()
    return body, 200 if body["status"] != "unhealthy" else 503
