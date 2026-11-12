"""Small pure-ish helpers whose failure modes the HTTP tests never reach.

The clock's named ranges, the cache's promise to degrade to a miss rather than
an error, live delivery's handling of a socket that went away, and the data
catalogue's notes — each is a few lines that a page relies on and that no
request in the suite exercises from end to end.
"""

from __future__ import annotations

import json
from datetime import UTC, date, datetime, timedelta
from types import SimpleNamespace

import pytest

# ── clock ────────────────────────────────────────────────────────────────


def test_iso_writes_utc_with_a_z_and_dates_plainly():
    from src.core.clock import iso

    assert iso(None) is None
    assert iso(date(2030, 1, 2)) == "2030-01-02"
    assert iso(datetime(2030, 1, 2, 3, 4, 5)) == "2030-01-02T03:04:05Z"
    plus_two = datetime(2030, 1, 2, 5, 0, tzinfo=UTC) + timedelta(0)
    assert iso(plus_two).endswith("Z")


def test_parse_accepts_iso_and_refuses_nonsense():
    from src.core.clock import parse

    assert parse(None) is None
    assert parse("") is None
    assert parse("not a time") is None
    assert parse("2030-01-02T03:04:05Z") == datetime(2030, 1, 2, 3, 4, 5, tzinfo=UTC)
    # A naive time is read as UTC rather than as the server's local zone.
    assert parse("2030-01-02T03:04:05").tzinfo is UTC


@pytest.mark.parametrize(
    "preset",
    [
        "today",
        "yesterday",
        "last_7_days",
        "last_30_days",
        "last_90_days",
        "current_month",
        "previous_month",
        "current_year",
        "previous_year",
        None,
        "something-unknown",
    ],
)
def test_every_named_range_runs_forwards(preset):
    from src.core.clock import previous_period, resolve_range

    start, end = resolve_range(preset)
    assert start < end
    before_start, before_end = previous_period(start, end)
    assert before_end == start
    assert before_end - before_start == end - start


def test_a_custom_range_uses_what_it_was_given_and_falls_back_otherwise():
    from src.core.clock import resolve_range

    start, end = resolve_range("custom", "2030-01-01", "2030-02-01")
    assert (start.year, start.month, end.month) == (2030, 1, 2)
    fallback_start, fallback_end = resolve_range("custom", "garbage", None)
    assert fallback_end - fallback_start == timedelta(days=30)


def test_previous_month_ends_where_this_month_starts():
    from src.core.clock import resolve_range

    start, end = resolve_range("previous_month")
    assert end.day == 1 and start.day == 1
    year_start, year_end = resolve_range("previous_year")
    assert year_end.year - year_start.year == 1


# ── cache: an optimisation, never a dependency ───────────────────────────


class _Broken:
    """A Redis client every call of which fails, as a dropped connection does."""

    def __getattr__(self, _name):
        def fail(*_args, **_kwargs):
            raise ConnectionError("redis went away")

        return fail


@pytest.fixture()
def broken_cache(monkeypatch):
    from src.core import cache

    monkeypatch.setattr(cache, "client", lambda: _Broken())
    return cache


def test_a_broken_cache_reads_as_a_miss_and_writes_as_nothing(broken_cache):
    cache = broken_cache
    assert cache.get_json("k") is None
    cache.set_json("k", {"a": 1})  # does not raise
    assert cache.generations("ticket", "ticket", "order") == {"ticket": 0, "order": 0}
    cache.bump("ticket")  # does not raise
    assert cache.invalidate("anything") == 0
    assert cache.incr("counter") == 0
    report = cache.health()
    assert report["status"] == "unavailable" and "went away" in report["error"]
    calls = []
    assert cache.cached("p", {"x": 1}, lambda: calls.append(1) or "fresh") == "fresh"
    assert calls == [1]


def test_no_cache_at_all_still_answers(monkeypatch):
    from src.core import cache

    monkeypatch.setattr(cache, "client", lambda: None)
    assert cache.generations() == {}
    assert cache.generations("a") == {"a": 0}
    assert cache.get_json("k") is None
    cache.set_json("k", 1)
    cache.bump("a")
    assert cache.invalidate("p") == 0
    assert cache.incr("c") == 0
    assert cache.health()["latency_ms"] is None


def test_an_unreachable_redis_disables_the_cache_once(monkeypatch):
    """One failed connect switches caching off rather than costing a timeout per call."""
    from src.config import Config
    from src.core import cache

    monkeypatch.setattr(Config, "CACHE_ENABLED", True)
    monkeypatch.setattr(Config, "REDIS_URL", "redis://127.0.0.1:1/0")
    monkeypatch.setattr(cache, "_client", None)
    monkeypatch.setattr(cache, "_unavailable", False)
    assert cache.client() is None
    assert cache._unavailable is True
    assert cache.client() is None


class _FakeRedis:
    def __init__(self):
        self.store: dict[str, str] = {}

    def get(self, key):
        return self.store.get(key)

    def set(self, key, value, ex=None):
        self.store[key] = value

    def mget(self, keys):
        return [self.store.get(key) for key in keys]

    def scan_iter(self, match, count):
        prefix = match.rstrip("*")
        return [key for key in list(self.store) if key.startswith(prefix)]

    def delete(self, key):
        self.store.pop(key, None)

    def ping(self):
        return True

    def pipeline(self):
        outer = self

        class Pipe:
            def __init__(self):
                self.ops = []

            def incr(self, key):
                self.ops.append(("incr", key))

            def expire(self, key, ttl):
                self.ops.append(("expire", key))

            def execute(self):
                results = []
                for op, key in self.ops:
                    if op == "incr":
                        outer.store[key] = str(int(outer.store.get(key) or 0) + 1)
                        results.append(int(outer.store[key]))
                    else:
                        results.append(True)
                return results

        return Pipe()


def test_a_working_cache_reads_through_bumps_and_invalidates(monkeypatch):
    from src.core import cache

    fake = _FakeRedis()
    monkeypatch.setattr(cache, "client", lambda: fake)

    produced = []
    first = cache.aggregate("t", {"q": 1}, depends_on=("ticket",), producer=lambda: produced.append(1) or [1])
    again = cache.aggregate("t", {"q": 1}, depends_on=("ticket",), producer=lambda: produced.append(1) or [2])
    assert first == again == [1] and produced == [1]
    cache.bump("ticket")
    assert cache.generations("ticket") == {"ticket": 1}
    assert cache.aggregate("t", {"q": 1}, depends_on=("ticket",), producer=lambda: [3]) == [3]
    assert cache.incr("counter") == 1
    assert cache.invalidate("t") >= 1
    assert cache.health()["status"] == "healthy"


# ── live delivery ────────────────────────────────────────────────────────


class _Socket:
    def __init__(self, fails: bool = False):
        self.sent: list[str] = []
        self.fails = fails

    def send(self, message):
        if self.fails:
            raise OSError("closed")
        self.sent.append(message)


@pytest.fixture()
def live(monkeypatch):
    from src.services import live as module

    monkeypatch.setattr(module, "_subscribers", type(module._subscribers)(set))
    monkeypatch.setattr(module, "_relay_started", False)
    return module


def test_a_message_reaches_every_open_tab_and_drops_closed_ones(live, monkeypatch):
    from src.core import cache

    monkeypatch.setattr(cache, "client", lambda: None)
    open_tab, other_tab, closed_tab = _Socket(), _Socket(), _Socket(fails=True)
    for socket in (open_tab, other_tab, closed_tab):
        live.subscribe("u1", socket)
    assert live.connection_count("u1") == 3
    assert live.connection_count() == 3

    assert live.publish_to_user("u1", {"kind": "ping"}) == 2
    assert json.loads(open_tab.sent[0]) == {"kind": "ping"}
    assert live.connection_count("u1") == 2, "the closed socket was dropped"

    live.unsubscribe("u1", open_tab)
    live.unsubscribe("u1", other_tab)
    live.unsubscribe("u1", other_tab)  # twice is harmless
    live.unsubscribe("nobody", open_tab)
    assert live.connection_count() == 0
    assert live.health()["users"] == 0


def test_a_failed_fan_out_still_delivers_locally(live, monkeypatch):
    from src.core import cache

    monkeypatch.setattr(cache, "client", lambda: _Broken())
    socket = _Socket()
    live.subscribe("u2", socket)
    assert live.publish_to_user("u2", {"n": 1}) == 1


def test_the_relay_needs_a_cache_and_starts_once(live, monkeypatch):
    from src.core import cache

    monkeypatch.setattr(cache, "client", lambda: None)
    assert live.start_relay() is False

    socket = _Socket()
    live.subscribe("u3", socket)
    message = {"data": json.dumps({"user_id": "u3", "payload": {"hello": 1}})}

    class PubSub:
        def subscribe(self, _channel):
            pass

        def listen(self):
            yield message

    monkeypatch.setattr(cache, "client", lambda: SimpleNamespace(pubsub=lambda **_: PubSub()))
    started = []

    class InlineThread:
        def __init__(self, target, **_kwargs):
            self.target = target

        def start(self):
            started.append(True)
            self.target()

    monkeypatch.setattr(live.threading, "Thread", InlineThread)
    assert live.start_relay() is True
    assert live.start_relay() is True
    assert started == [True], "a second call does not start a second relay"
    assert json.loads(socket.sent[0]) == {"hello": 1}


# ── the data catalogue's notes ───────────────────────────────────────────


def _resource(searchable=True):
    return SimpleNamespace(fields=SimpleNamespace(searchable=["name"] if searchable else []))


def test_an_empty_dataset_says_so_and_nothing_else():
    from src.services.catalog import _notes

    notes = _notes(_resource(), [], 0, None)
    assert [note["level"] for note in notes] == ["warning"]


def test_sparse_stale_and_unsearchable_datasets_are_described():
    from src.core.clock import now
    from src.services.catalog import _notes

    fields = [{"label": f"F{i}", "completeness": 10.0} for i in range(7)]
    notes = _notes(_resource(searchable=False), fields, 100, now() - timedelta(days=400))
    messages = " ".join(note["message"] for note in notes)
    assert "and others" in messages
    assert "400 days" in messages or "399 days" in messages
    assert "free-text searchable" in messages


@pytest.mark.database
def test_every_dataset_profiles_and_samples(client, monkeypatch):
    """Profiled directly, past the cache — a warm Redis would otherwise skip it."""
    from src.core.db import session_scope
    from src.core.errors import ValidationError
    from src.services import catalog
    from src.services.explorer import resources

    class Everyone:
        def can(self, *_):
            return True

        def require(self, *_):
            return None

    with session_scope() as session:
        everything = catalog.catalogue(session, principal=Everyone(), refresh=True)
        assert everything["total"] == len(resources())
        assert everything["field_count"] > 0
        for item in everything["items"]:
            assert all(0 <= field["completeness"] <= 100 for field in item["fields"])

        key = next(iter(resources()))
        profiled = catalog._profile(session, resources()[key])
        assert profiled["key"] == key
        with pytest.raises(ValidationError):
            catalog.dataset(session, "no-such-dataset", principal=Everyone())
        with pytest.raises(ValidationError):
            catalog.sample(session, "no-such-dataset", principal=Everyone(), field="x")
        with pytest.raises(ValidationError):
            catalog.sample(session, key, principal=Everyone(), field="no-such-field")
        field = resources()[key].fields.fields[0].name
        sampled = catalog.sample(session, key, principal=Everyone(), field=field)
        assert sampled["resource_type"] == key
