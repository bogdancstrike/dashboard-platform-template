"""Redis caching, with the cache treated as an optimisation and never a
dependency.
See docs/architecture/backend/cache.md."""

from __future__ import annotations

from src.core.facade import lazy

__getattr__, __dir__, __all__ = lazy(__name__, {
    "connection": (
        "_client", "_unavailable", "_retry_at", "_lost_bumps", "RETRY_SECONDS", "_trip", "_failed",
        "client", "key_for", "get_json", "set_json", "cached", "_generation_key",
    ),
    "invalidation": (
        "AGGREGATE_TTL_SECONDS", "generations", "bump", "aggregate", "invalidate", "health",
        "incr",
    ),
})
