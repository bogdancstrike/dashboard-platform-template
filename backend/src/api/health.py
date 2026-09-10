"""Health endpoints.

Handlers take QF's calling convention — `(app, operation, request, **params)` —
and return `(body, status)`. The status codes matter more than the bodies here:
an orchestrator reads the code, and a readiness probe that answers 200 while
the database is unreachable will happily route traffic into a broken process.
"""

from __future__ import annotations

from typing import Any

from src.core.auth import me, requires
from src.core.db import session_scope
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


@requires("health.view")
def history(app=None, operation: str = "", request=None, **_: Any):
    """What each dependency was doing across a window (§24).

    Unlike the three probes above, this one **needs a permission**: the others
    are what an orchestrator and an uptime monitor poll, and neither holds a
    token. A history is a record of when the platform was broken, which is
    operational detail rather than a liveness signal.
    """
    args = request.args if request is not None else {}
    with session_scope() as session:
        return probes.history(session, args, principal=me()), 200
