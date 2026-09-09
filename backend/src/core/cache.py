"""Redis caching, with the cache treated as an optimisation and never a
dependency.

Every helper degrades to a miss when Redis is unreachable. A dashboard that
returns a 503 because a *cache* is down is worse than one that recomputes.

**Aggregates are invalidated by the writes that make them stale, not by a
timer.** A dashboard behind a five-minute TTL tells somebody who has just
closed a ticket that it is still open, and the number they are checking is the
one they changed — so the cache would be worse than none: it makes the screen
*wrong* rather than slow, and only for the person best placed to notice.

The mechanism is a **generation per dataset** rather than a scan-and-delete.
Each dataset has a counter in Redis; an aggregate's cache key includes the
current counter of every dataset it summarises; a write bumps the counter,
which makes every key mentioning that dataset unreachable at once. Three
properties follow, and all three matter:

* Invalidation is O(1) and needs no `SCAN` — deleting by prefix over a large
  keyspace is slow and, worse, non-atomic, so a request in flight can write a
  stale entry back after the delete has passed.
* An aggregate over *five* datasets is invalidated by a write to any one of
  them, which no prefix scheme expresses. The dashboard is exactly that.
* A stale entry is never *read*, only left behind — and the TTL sweeps it.

The TTL stays as a backstop. It is not the invalidation mechanism; it is what
bounds the memory a bumped generation abandons.
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
        # `set(..., ex=)` rather than `setex`, which redis-py deprecated.
        conn.set(key, json.dumps(value, default=str), ex=ttl or Config.CACHE_TTL_SECONDS)
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


# ── generations: what makes an aggregate stale ────────────────────────────

#: How long a cached aggregate lives even if nothing invalidates it.
#:
#: Short, because it is a backstop and not the mechanism: the writes bump the
#: generation, and this only bounds what an abandoned key costs in memory. A
#: long TTL here would also be the *only* thing standing between a reader and a
#: stale answer if a write path ever forgot to bump — so it is short enough
#: that the failure would be a slightly slow page rather than a wrong one.
AGGREGATE_TTL_SECONDS = 300


def _generation_key(dataset: str) -> str:
    return f"{Config.SERVICE_NAME}:gen:{dataset}"


def generations(*datasets: str) -> dict[str, int]:
    """The current version of each dataset, for stamping into a cache key.

    Missing means nought, which is the right answer: a dataset nobody has
    written to since the process started has a stable generation, and the first
    write moves it.

    One `MGET` rather than a read per dataset, because the dashboard depends on
    five and five round trips to Redis is most of what the cache was saving.
    """
    names = tuple(dict.fromkeys(datasets))
    if not names:
        return {}
    conn = client()
    if conn is None:
        # No cache means no generations, and `aggregate` below will simply run
        # the producer. Returning zeroes rather than raising keeps the caller
        # free of "is caching on" branching.
        return dict.fromkeys(names, 0)
    try:
        values = conn.mget([_generation_key(name) for name in names])
    except Exception:
        return dict.fromkeys(names, 0)
    return {
        name: int(value) if value not in (None, "") else 0
        for name, value in zip(names, values, strict=True)
    }


def bump(*datasets: str) -> None:
    """A write happened: every cached answer that mentioned these is now unread.

    Nothing is deleted. The keys that named the old generation are simply never
    asked for again, and their TTL removes them — which is what makes this
    atomic. A delete-by-prefix leaves a window in which a request that read
    just before the write can store its answer just after it.
    """
    conn = client()
    if conn is None:
        return
    try:
        pipe = conn.pipeline()
        for name in dict.fromkeys(datasets):
            pipe.incr(_generation_key(name))
        pipe.execute()
    except Exception:
        # A cache that cannot be invalidated must not break the write that
        # tried. The TTL is what covers this case, which is why it is short.
        pass


def aggregate(
    prefix: str,
    payload: Any,
    *,
    depends_on: tuple[str, ...] | list[str],
    producer: Callable[[], Any],
    ttl: int | None = None,
) -> Any:
    """Read-through cache for an expensive `GROUP BY`, keyed on its own inputs
    *and* on the generation of every dataset it summarises.

    `depends_on` is the whole design. Getting it wrong in one direction serves
    a stale number; in the other it throws away a cache entry that was still
    good. It is a declaration rather than something inferred from the SQL,
    because a reader can check a declaration.
    """
    stamped = {"query": payload, "generations": generations(*depends_on)}
    return cached(prefix, stamped, producer, ttl or AGGREGATE_TTL_SECONDS)


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
