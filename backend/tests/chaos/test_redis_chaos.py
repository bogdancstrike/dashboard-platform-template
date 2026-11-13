"""Redis down, hung or back again: the cache must degrade and recover (§ caching).

The cache is an optimisation, never a dependency. These pin the three ways it
used to fall short of that:

* one failed connection switched caching off **for the life of the process**,
  so a Redis restart left every worker recomputing every dashboard and
  re-verifying every token signature until the API itself was restarted;
* a *hung* Redis (accepts, never answers) cost its 2 s socket timeout on
  **every** cache call, so each request paid it several times over;
* a write made while Redis was unreachable could not bump its dataset's
  generation, so after recovery an aggregate cached before the outage looked
  fresh.
"""

from __future__ import annotations

import pytest

from src.config import Config
from src.core import cache
from tests.chaos.conftest import REFUSED_HOST, REFUSED_PORT, Stopwatch


@pytest.fixture()
def fresh_cache(monkeypatch):
    """A cache module in its pristine state, with caching switched on."""
    monkeypatch.setattr(Config, "CACHE_ENABLED", True)
    monkeypatch.setattr(cache, "_client", None)
    monkeypatch.setattr(cache, "_unavailable", False)
    monkeypatch.setattr(cache, "_retry_at", 0.0)
    monkeypatch.setattr(cache, "_lost_bumps", set())
    clock = {"now": 1000.0}
    monkeypatch.setattr("time.monotonic", lambda: clock["now"])
    return clock


class _HungRedis:
    """Connected, then every command times out — Redis wedged mid-flight."""

    def __init__(self):
        self.calls = 0

    def ping(self):
        return True

    def _hang(self, *_args, **_kwargs):
        from redis.exceptions import TimeoutError as RedisTimeoutError

        self.calls += 1
        raise RedisTimeoutError("Timeout reading from socket")

    get = set = mget = incr = _hang

    def pipeline(self):
        return self

    def execute(self):
        return self._hang()

    def expire(self, *_args):
        return self


class _GoodRedis:
    def __init__(self, store=None):
        self.store = {} if store is None else store
        self.pinged = 0

    def ping(self):
        self.pinged += 1
        return True

    def get(self, key):
        return self.store.get(key)

    def set(self, key, value, ex=None):
        self.store[key] = value

    def mget(self, keys):
        return [self.store.get(k) for k in keys]

    def incr(self, key):
        self.store[key] = str(int(self.store.get(key) or 0) + 1)
        return int(self.store[key])

    def scan_iter(self, match="*", count=None):
        import fnmatch

        return [k for k in list(self.store) if fnmatch.fnmatch(k, match)]


def test_refused_redis_is_a_miss_not_an_error(fresh_cache, monkeypatch):
    monkeypatch.setattr(Config, "REDIS_URL", f"redis://{REFUSED_HOST}:{REFUSED_PORT}/0")
    with Stopwatch() as watch:
        produced = cache.cached("chaos", {"q": 1}, lambda: {"answer": 42})
        again = cache.aggregate("chaos", {"q": 2}, depends_on=("ticket",), producer=lambda: [1, 2])
    assert produced == {"answer": 42} and again == [1, 2]
    assert cache.health()["status"] == "unavailable"
    assert watch.seconds < 2.5  # refused is immediate; no timeout per call


def test_a_hung_redis_costs_one_timeout_then_the_cache_steps_aside(fresh_cache, monkeypatch):
    hung = _HungRedis()
    monkeypatch.setattr(cache, "_client", hung)
    for _ in range(20):
        assert cache.get_json("k") is None
        cache.set_json("k", 1)
        assert cache.generations("ticket") == {"ticket": 0}
        cache.bump("ticket")
        assert cache.incr("counter") == 0
    assert hung.calls == 1, "after one timeout, nothing more is sent to a hung Redis"
    assert cache.client() is None


def test_a_non_connection_error_does_not_switch_the_cache_off(fresh_cache, monkeypatch):
    class _WrongType(_GoodRedis):
        def get(self, key):
            from redis.exceptions import ResponseError

            raise ResponseError("WRONGTYPE Operation against a key holding the wrong kind of value")

    monkeypatch.setattr(cache, "_client", _WrongType())
    assert cache.get_json("k") is None
    assert cache.client() is not None


def test_the_cache_comes_back_after_redis_does(fresh_cache, monkeypatch):
    import redis

    store: dict[str, str] = {}
    attempts = {"n": 0}

    def from_url(*_args, **_kwargs):
        attempts["n"] += 1
        if attempts["n"] == 1:
            raise redis.exceptions.ConnectionError("Connection refused")
        return _GoodRedis(store)

    monkeypatch.setattr(redis.Redis, "from_url", staticmethod(from_url))
    assert cache.client() is None  # down
    fresh_cache["now"] += cache.RETRY_SECONDS / 2
    assert cache.client() is None  # still backing off: no reconnect attempt
    assert attempts["n"] == 1
    fresh_cache["now"] += cache.RETRY_SECONDS
    assert cache.client() is not None  # back
    cache.set_json("k", {"v": 1})
    assert cache.get_json("k") == {"v": 1}


def test_recovery_retires_aggregates_cached_before_the_outage(fresh_cache, monkeypatch):
    """A write during the outage could not bump; recovery must make up for it."""
    import redis

    store: dict[str, str] = {}
    good = _GoodRedis(store)
    monkeypatch.setattr(cache, "_client", good)
    first = cache.aggregate("chaos-agg", {"q": 1}, depends_on=("ticket",), producer=lambda: "before")
    assert first == "before"

    # Redis goes away; a ticket is closed meanwhile (its bump is lost).
    cache._trip()
    cache.bump("ticket")

    # Redis comes back with its old contents.
    monkeypatch.setattr(redis.Redis, "from_url", staticmethod(lambda *_a, **_k: _GoodRedis(store)))
    fresh_cache["now"] += cache.RETRY_SECONDS + 1
    after = cache.aggregate("chaos-agg", {"q": 1}, depends_on=("ticket",), producer=lambda: "after")
    assert after == "after", "an aggregate cached before the outage was served as fresh"


@pytest.mark.database
def test_dashboard_answers_with_redis_down(client, monkeypatch, fresh_cache):
    """End to end: the pages that lean on the cache hardest still answer."""
    from tests.conftest import persona_claims

    monkeypatch.setattr(Config, "REDIS_URL", f"redis://{REFUSED_HOST}:{REFUSED_PORT}/0")
    monkeypatch.setattr("src.core.auth.tokens.verify_token", lambda _t: persona_claims("user", "user", sid="chaos-redis"))
    headers = {"Authorization": "Bearer chaos"}
    for path in ("/dashboard/summary", "/dashboard/alerts", "/notifications/counts", "/api/me"):
        response = client.get(f"{Config.API_PREFIX}{path}", headers=headers)
        assert response.status_code == 200, (path, response.get_data(as_text=True)[:200])
