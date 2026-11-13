"""Presence (§47) and the live channel's broadcast.

Presence is bookkeeping about sockets, so it is tested as bookkeeping: with no
cache (one process), with a cache standing in for Redis (many workers), and
with a cache that fails — which must degrade to the in-process answer rather
than to an error.
"""

from __future__ import annotations

import json
import time

import pytest

from src.core import cache
from src.services.collaboration import live, presence
from tests.patching import patch_package


class FakeRedis:
    def __init__(self):
        self.values: dict[str, str] = {}
        self.published: list[tuple[str, str]] = []

    def get(self, key):
        return self.values.get(key)

    def set(self, key, value, ex=None):
        self.values[key] = value

    def delete(self, *keys):
        for key in keys:
            self.values.pop(key, None)

    def incrby(self, key, amount):
        self.values[key] = str(int(self.values.get(key, "0")) + amount)
        return int(self.values[key])

    def expire(self, key, seconds):
        return True

    def mget(self, keys):
        return [self.values.get(key) for key in keys]

    def scan_iter(self, match, count=None):
        prefix = match.rstrip("*")
        return [key for key in list(self.values) if key.startswith(prefix)]

    def publish(self, channel, message):
        self.published.append((channel, message))


class BrokenRedis:
    def __getattr__(self, name):
        def fail(*args, **kwargs):
            raise ConnectionError("down")

        return fail


@pytest.fixture()
def broadcasts(monkeypatch):
    sent: list[dict] = []
    monkeypatch.setattr(live, "publish_to_all", lambda payload: sent.append(payload) or 0)
    presence.reset_for_tests()
    yield sent
    presence.reset_for_tests()


@pytest.fixture(params=["local", "redis", "broken"])
def store(request, monkeypatch):
    client = {"local": None, "redis": FakeRedis(), "broken": BrokenRedis()}[request.param]
    patch_package(monkeypatch, cache, "client", lambda: client)
    return client


def test_a_socket_makes_its_owner_online_and_the_last_one_offline(store, broadcasts):
    assert presence.connected("u1") == "online"
    assert presence.connected("u1") == "online"  # a second tab
    assert broadcasts == [{"type": "presence", "user_id": "u1", "status": "online"}]
    assert presence.status_of(["u1", "u2", ""]) == {"u1": "online", "u2": "offline"}
    assert presence.status_of([]) == {}

    assert presence.disconnected("u1") == "online", "one tab is still open"
    assert presence.disconnected("u1") == "offline"
    assert broadcasts[-1] == {"type": "presence", "user_id": "u1", "status": "offline"}
    assert presence.status_of(["u1"]) == {"u1": "offline"}


def test_the_browser_reports_away_and_back(store, broadcasts):
    presence.connected("u1")
    assert presence.set_status("u1", "AWAY") == {"user_id": "u1", "status": "away"}
    assert presence.everyone() == {"u1": "away"}
    presence.set_status("u1", "away")  # unchanged: no second broadcast
    assert [item["status"] for item in broadcasts] == ["online", "away"]
    # A heartbeat keeps the status it has rather than resetting it.
    presence.heartbeat("u1")
    assert presence.status_of(["u1"]) == {"u1": "away"}
    # A new tab does not make an away person online.
    assert presence.connected("u1") == "away"

    with pytest.raises(Exception):
        presence.set_status("u1", "invisible")


def test_a_heartbeat_revives_a_status_that_lapsed(store, broadcasts):
    presence.heartbeat("u9")
    assert presence.status_of(["u9"]) == {"u9": "online"}


def test_only_the_heartbeat_and_a_status_are_accepted_from_the_socket(store, broadcasts):
    assert presence.client_frame("u1", "pong") is True
    assert presence.client_frame("u1", json.dumps({"type": "presence", "status": "away"})) is True
    assert presence.status_of(["u1"]) == {"u1": "away"}
    assert presence.client_frame("u1", json.dumps({"type": "presence", "status": "bogus"})) is False
    assert presence.client_frame("u1", json.dumps({"type": "delete_everything"})) is False
    assert presence.client_frame("u1", "{not json") is False
    assert presence.client_frame("u1", "hello") is False
    assert presence.client_frame("u1", "[1]") is False


def test_a_lapsed_local_status_reads_as_offline(monkeypatch, broadcasts):
    patch_package(monkeypatch, cache, "client", lambda: None)
    presence.set_status("u1", "online")
    monkeypatch.setattr(time, "monotonic", lambda: 10**12)
    assert presence.status_of(["u1"]) == {"u1": "offline"}
    assert presence.everyone() == {}


def test_a_broadcast_reaches_every_socket_and_skips_its_own_echo(monkeypatch):
    class Socket:
        def __init__(self):
            self.sent = []

        def send(self, message):
            self.sent.append(json.loads(message))

    fake = FakeRedis()
    patch_package(monkeypatch, cache, "client", lambda: fake)
    first, second = Socket(), Socket()
    live.subscribe("a", first)
    live.subscribe("b", second)
    try:
        assert set(live.connected_user_ids()) >= {"a", "b"}
        assert live.publish_to_all({"type": "presence"}) >= 2
        assert first.sent == [{"type": "presence"}] and second.sent == [{"type": "presence"}]
        channel, message = fake.published[-1]
        body = json.loads(message)
        assert body["user_id"] == live.EVERYONE and body["origin"] == live.ORIGIN

        # The copy of our own publish that comes back is not delivered twice…
        assert live.relay(body) == 0
        # …but one from another worker is, to everybody or to one person.
        assert live.relay({**body, "origin": "elsewhere"}) >= 2
        assert live.relay({"user_id": "a", "payload": {"type": "x"}, "origin": "elsewhere"}) == 1
        assert first.sent[-1] == {"type": "x"}
    finally:
        live.unsubscribe("a", first)
        live.unsubscribe("b", second)


def test_a_broadcast_survives_a_cache_that_refuses(monkeypatch):
    patch_package(monkeypatch, cache, "client", lambda: BrokenRedis())
    assert live.publish_to_all({"type": "presence"}) >= 0
