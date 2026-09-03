"""Redis caching, with the cache treated as an optimisation and never a
dependency.

Every helper degrades to a miss when Redis is unreachable. A dashboard that
returns a 503 because a *cache* is down is worse than one that recomputes.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Callable
from typing import Any

from src.config import Config

_client = None
_unavailable = False


def client():
    """The shared Redis client, or None when caching is off/unreachable."""
    global _client, _unavailable
    if not Config.CACHE_ENABLED or _unavailable:
        return None
    if _client is None:
        try:
            import redis

            _client = redis.Redis.from_url(
                Config.REDIS_URL,
                socket_timeout=2.0,
                socket_connect_timeout=2.0,
                retry_on_timeout=True,
                decode_responses=True,
            )
            _client.ping()
        except Exception:
            # One failed connection disables the cache for the process rather
            # than paying a 2s timeout on every subsequent request.
            _unavailable = True
            _client = None
    return _client


def key_for(prefix: str, payload: Any) -> str:
    digest = hashlib.sha1(
        json.dumps(payload, sort_keys=True, default=str).encode()
    ).hexdigest()[:16]
    return f"{Config.SERVICE_NAME}:{prefix}:{digest}"


def get_json(key: str) -> Any | None:
    conn = client()
    if conn is None:
        return None
    try:
        raw = conn.get(key)
        return json.loads(raw) if raw else None
    except Exception:
        return None


def set_json(key: str, value: Any, ttl: int | None = None) -> None:
    conn = client()
    if conn is None:
        return
    try:
        conn.setex(key, ttl or Config.CACHE_TTL_SECONDS, json.dumps(value, default=str))
    except Exception:
        pass


def cached(prefix: str, payload: Any, producer: Callable[[], Any], ttl: int | None = None) -> Any:
    """Read-through cache around one expensive computation."""
    key = key_for(prefix, payload)
    hit = get_json(key)
    if hit is not None:
        return hit
    value = producer()
    set_json(key, value, ttl)
    return value


def invalidate(prefix: str) -> int:
    """Drop every entry under a prefix — called after writes that change what
    the dashboards summarise."""
    conn = client()
    if conn is None:
        return 0
    removed = 0
    try:
        for key in conn.scan_iter(match=f"{Config.SERVICE_NAME}:{prefix}:*", count=500):
            conn.delete(key)
            removed += 1
    except Exception:
        return removed
    return removed


def health() -> dict[str, Any]:
    conn = client()
    if conn is None:
        return {"status": "unavailable" if Config.CACHE_ENABLED else "disabled", "latency_ms": None}
    import time

    started = time.perf_counter()
    try:
        conn.ping()
        return {
            "status": "healthy",
            "latency_ms": round((time.perf_counter() - started) * 1000, 2),
        }
    except Exception as exc:
        return {"status": "unavailable", "latency_ms": None, "error": str(exc)[:200]}


# ── Small shared counters, used by the live log stream and rate limits ────


def incr(key: str, ttl: int = 60) -> int:
    conn = client()
    if conn is None:
        return 0
    try:
        pipe = conn.pipeline()
        pipe.incr(key)
        pipe.expire(key, ttl)
        return int(pipe.execute()[0])
    except Exception:
        return 0
