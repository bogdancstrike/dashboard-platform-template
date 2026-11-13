"""Generation counters for invalidation, aggregate caching, health and counters."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from src.config import Config
from src.core.cache.connection import (
    _failed,
    _generation_key,
    _lost_bumps,
    cached,
    client,
)

#: How long a cached aggregate lives even if nothing invalidates it.
#:
#: Short, because it is a backstop and not the mechanism: the writes bump the
#: generation, and this only bounds what an abandoned key costs in memory. A
#: long TTL here would also be the *only* thing standing between a reader and a
#: stale answer if a write path ever forgot to bump — so it is short enough
#: that the failure would be a slightly slow page rather than a wrong one.
AGGREGATE_TTL_SECONDS = 300


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
    except Exception as exc:
        _failed(exc)
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
        if Config.CACHE_ENABLED:
            _lost_bumps.update(name for name in datasets if name)
        return
    try:
        pipe = conn.pipeline()
        for name in dict.fromkeys(datasets):
            pipe.incr(_generation_key(name))
        pipe.execute()
    except Exception as exc:
        # A cache that cannot be invalidated must not break the write that
        # tried. The lost bump is replayed when Redis is back, and the TTL
        # bounds the rest.
        _lost_bumps.update(name for name in datasets if name)
        _failed(exc)


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


def incr(key: str, ttl: int = 60) -> int:
    conn = client()
    if conn is None:
        return 0
    try:
        pipe = conn.pipeline()
        pipe.incr(key)
        pipe.expire(key, ttl)
        return int(pipe.execute()[0])
    except Exception as exc:
        _failed(exc)
        return 0
