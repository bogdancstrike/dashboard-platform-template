"""Fault injection for the chaos suite (docs/testing/chaos.md).

Nothing here stops a shared container. Each dependency is broken *for this
process only*, the way it breaks in production:

* **refused** — a closed port (``127.0.0.1:1``): connections fail at once;
* **hung** — :class:`BlackHole`, a listening socket that accepts and never
  answers: connections succeed and every read waits, which is the failure
  timeouts exist for;
* **slow** — :class:`SlowHttp`, an HTTP server that answers after a delay or
  trickles a response.

Each test restores what it broke (monkeypatch, or an explicit reset), so the
rest of the suite never sees a broken dependency.
"""

from __future__ import annotations

import socket
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

REFUSED_HOST = "127.0.0.1"
REFUSED_PORT = 1


class BlackHole:
    """Accepts TCP connections and never sends a byte."""

    def __init__(self) -> None:
        self._sock = socket.socket()
        self._sock.bind(("127.0.0.1", 0))
        self._sock.listen(64)
        self.port = self._sock.getsockname()[1]
        self._held: list[socket.socket] = []
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._accept, daemon=True)
        self._thread.start()

    def _accept(self) -> None:
        self._sock.settimeout(0.2)
        while not self._stop.is_set():
            try:
                conn, _ = self._sock.accept()
                self._held.append(conn)
            except OSError:
                continue

    def close(self) -> None:
        self._stop.set()
        for conn in self._held:
            conn.close()
        self._sock.close()


class SlowHttp:
    """An HTTP server whose every answer takes ``delay`` seconds.

    With ``trickle=True`` it sends a server-sent-event line every ``delay``
    seconds forever — a stream that is alive but never finishes.
    """

    def __init__(self, delay: float, *, trickle: bool = False, body: bytes = b"{}") -> None:
        outer = self
        self.requests = 0

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_args):  # quiet
                pass

            def do_POST(self):  # noqa: N802
                outer.requests += 1
                length = int(self.headers.get("Content-Length") or 0)
                self.rfile.read(length)
                if trickle:
                    self.send_response(200)
                    self.send_header("Content-Type", "text/event-stream")
                    self.end_headers()
                    try:
                        while True:
                            self.wfile.write(b'data: {"choices":[{"delta":{"content":"."}}]}\n\n')
                            self.wfile.flush()
                            time.sleep(delay)
                    except OSError:
                        return
                time.sleep(delay)
                try:
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json")
                    self.send_header("Content-Length", str(len(body)))
                    self.end_headers()
                    self.wfile.write(body)
                except OSError:
                    pass

            do_GET = do_POST  # noqa: N815

        self._server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self._server.daemon_threads = True
        self.port = self._server.server_address[1]
        self.url = f"http://127.0.0.1:{self.port}"
        threading.Thread(target=self._server.serve_forever, daemon=True).start()

    def close(self) -> None:
        self._server.shutdown()
        self._server.server_close()


@pytest.fixture()
def black_hole():
    hole = BlackHole()
    yield hole
    hole.close()


@pytest.fixture()
def slow_http():
    servers: list[SlowHttp] = []

    def _make(delay: float, **kwargs) -> SlowHttp:
        server = SlowHttp(delay, **kwargs)
        servers.append(server)
        return server

    yield _make
    for server in servers:
        server.close()


class Stopwatch:
    def __enter__(self):
        self.started = time.perf_counter()
        return self

    def __exit__(self, *_exc):
        self.seconds = time.perf_counter() - self.started
        return False
