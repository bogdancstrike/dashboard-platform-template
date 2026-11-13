"""Who is here: online, away, or gone (§47).
See docs/architecture/backend/presence.md."""

from __future__ import annotations

from src.core.facade import lazy

__getattr__, __dir__, __all__ = lazy(__name__, {
    "store": (
        "TTL_SECONDS", "STATUSES", "_PREFIX", "_local_status", "_local_connections", "_lock",
        "_redis", "_status_key", "_conn_key", "_broadcast", "_current", "_store", "_clear",
        "_count", "connected", "heartbeat", "disconnected",
    ),
    "status": ("set_status", "status_of", "everyone", "client_frame", "reset_for_tests"),
})
