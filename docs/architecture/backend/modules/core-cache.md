# `src/core/cache`

Redis caching, with the cache treated as an optimisation and never a
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
