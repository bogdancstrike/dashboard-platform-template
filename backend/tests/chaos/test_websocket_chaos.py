"""Live channel drops: a retiring worker lets go of its sockets at once.

A live socket (`/platform/live`) is a request that never finishes on its own.
When gunicorn retires a worker — `max_requests` reached, or a deploy's SIGTERM —
the worker stops accepting and waits up to `graceful_timeout` for its requests.
It used to wait the full 30 s for sockets that were never going to end, and
with both workers retiring together (they reach `max_requests` together under
an even load) the API answered *nothing* for that long: the stall the
1000-user load test found every ~20 s.

`gunicorn.conf.post_worker_init` now closes them with 1012 (service restart)
the moment the worker stops being alive. The browser's side of the contract —
fall back to polling, reconnect with backoff — is pinned by
`frontend/src/live/LiveProvider.test.tsx` ("reconnects with backoff after the
socket drops", "treats a silent socket as dead", "polls until the socket
opens").
"""

from __future__ import annotations

import importlib.util
import threading
from pathlib import Path

import gevent

from src.services import live

CONF = Path(__file__).resolve().parents[2] / "gunicorn.conf.py"


def _gunicorn_conf():
    spec = importlib.util.spec_from_file_location("nucleus_gunicorn_conf", CONF)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class _Socket:
    def __init__(self, *, broken: bool = False):
        self.closed_with = None
        self.event = threading.Event()
        self.broken = broken

    def close(self, reason=None, message=None):
        if self.broken:
            raise RuntimeError("already closed")
        self.closed_with = (reason, message)


class _Worker:
    alive = True


def test_retiring_worker_closes_its_live_sockets_with_1012(monkeypatch):
    sockets = [_Socket(), _Socket(), _Socket(broken=True)]
    monkeypatch.setattr(live, "_subscribers", {"u1": {sockets[0], sockets[2]}, "u2": {sockets[1]}})
    worker = _Worker()
    # The watcher is a greenlet polling `worker.alive`. Run it ourselves
    # rather than racing its 0.5 s poll against wall-clock sleeps, which
    # failed now and then in a loaded full run: first while the worker is
    # alive (it must close nothing and keep waiting), then once it retires.
    watchers = []
    monkeypatch.setattr(gevent, "spawn", lambda fn, *a, **k: watchers.append(fn))
    _gunicorn_conf().post_worker_init(worker)
    assert len(watchers) == 1

    polls = {"n": 0}

    def sleep(_seconds):
        polls["n"] += 1
        assert all(s.closed_with is None for s in sockets), "nothing is closed while the worker is alive"
        if polls["n"] == 3:
            worker.alive = False

    monkeypatch.setattr(gevent, "sleep", sleep)
    watchers[0]()
    assert polls["n"] == 3
    assert sockets[0].closed_with == (1012, "server restarting")
    assert sockets[1].closed_with == (1012, "server restarting")
    # Each waiting receive() is woken rather than left to its 25 s heartbeat.
    assert all(s.event.is_set() for s in sockets)


def test_worker_recycling_is_spread_out():
    """Two workers must not reach `max_requests` in the same second."""
    conf = _gunicorn_conf()
    assert conf.max_requests >= 10_000
    assert conf.max_requests_jitter >= conf.max_requests // 4
