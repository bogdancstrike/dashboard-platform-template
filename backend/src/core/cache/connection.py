"""The Redis client, tripped and retried after a failure; JSON get/set and the cached decorator."""

from __future__ import annotations

import hashlib
import json
from collections.abc import Callable
from typing import Any

from src.config import Config

_client = None


_unavailable = False


#: When a tripped cache may try Redis again (monotonic seconds).
_retry_at = 0.0


#: Datasets written while Redis was unreachable, bumped on reconnect.
_lost_bumps: set[str] = set()


#: How long the cache stays off after Redis failed, before one request tries
#: again. Long enough that a hung Redis costs one 2 s timeout per worker per
#: half-minute rather than one per call; short enough that a restarted Redis is
#: back in use within the half-minute (docs/testing/chaos.md).
RETRY_SECONDS = 30.0


def _trip() -> None:
    """Redis just failed: stop using it, and schedule one retry."""
    global _client, _unavailable, _retry_at
    import time

    _unavailable = True
    _client = None
    _retry_at = time.monotonic() + RETRY_SECONDS


def _failed(exc: Exception) -> None:
    """Trip the breaker if the failure was Redis being unreachable or hung.

    Anything else (a wrong-type key, a bad payload) is a miss for this call
    only — it says nothing about whether the next call will work.
    """
    try:
        from redis.exceptions import ConnectionError as RedisConnectionError
        from redis.exceptions import TimeoutError as RedisTimeoutError
    except ImportError:  # pragma: no cover - redis is a requirement
        return
    if isinstance(exc, (RedisConnectionError, RedisTimeoutError, OSError)):
        _trip()


def client():
    """The shared Redis client, or None when caching is off/unreachable.

    A failure switches the cache off for `RETRY_SECONDS` — it used to switch it
    off for the life of the process, so one Redis restart left every worker
    recomputing every dashboard and re-verifying every token signature until
    the API itself was restarted.
    """
    global _client, _unavailable
    if not Config.CACHE_ENABLED:
        return None
    recovering = False
    if _unavailable:
        import time

        if time.monotonic() < _retry_at:
            return None
        _unavailable = False
        recovering = True
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
            if recovering and _lost_bumps:
                # Writes made while Redis was unreachable could not bump their
                # datasets' generations, so an aggregate cached before the
                # outage would now look fresh. Replay them.
                for dataset in sorted(_lost_bumps):
                    _client.incr(_generation_key(dataset))
                _lost_bumps.clear()
        except Exception:
            # Off for a while rather than paying a 2s timeout on every request.
            _trip()
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
    except Exception as exc:
        _failed(exc)
        return None


def set_json(key: str, value: Any, ttl: int | None = None) -> None:
    conn = client()
    if conn is None:
        return
    try:
        # `set(..., ex=)` rather than `setex`, which redis-py deprecated.
        conn.set(key, json.dumps(value, default=str), ex=ttl or Config.CACHE_TTL_SECONDS)
    except Exception as exc:
        _failed(exc)


def cached(prefix: str, payload: Any, producer: Callable[[], Any], ttl: int | None = None) -> Any:
    """Read-through cache around one expensive computation."""
    key = key_for(prefix, payload)
    hit = get_json(key)
    if hit is not None:
        return hit
    value = producer()
    set_json(key, value, ttl)
    return value


def _generation_key(dataset: str) -> str:
    return f"{Config.SERVICE_NAME}:gen:{dataset}"
