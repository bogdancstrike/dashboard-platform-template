"""PostgreSQL unavailable, hung, slow or out of connections.

The contract: a dependency outage is a **503** with the normal error envelope
and a ``Retry-After`` — never a 500 "internal server error" (which sends people
to the wrong page and on-call to the wrong code), and never a request that
hangs. Liveness keeps answering; readiness says not ready.
"""

from __future__ import annotations

import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

from src.config import Config
from src.core import db
from tests.chaos.conftest import REFUSED_HOST, REFUSED_PORT, Stopwatch
from tests.conftest import persona_claims

PREFIX = Config.API_PREFIX


@pytest.fixture()
def signed_in(monkeypatch):
    monkeypatch.setattr("src.core.auth.verify_token", lambda _t: persona_claims("user", "user", sid="chaos-db"))
    return {"Authorization": "Bearer chaos"}


def _use_engine(monkeypatch, engine):
    monkeypatch.setattr(db, "_engine", engine)
    monkeypatch.setattr(db, "_SessionLocal", sessionmaker(bind=engine, expire_on_commit=False, future=True))


@pytest.fixture()
def database_down(monkeypatch):
    engine = create_engine(
        f"postgresql+psycopg2://t:t@{REFUSED_HOST}:{REFUSED_PORT}/t",
        pool_pre_ping=True, connect_args={"connect_timeout": 2},
    )
    _use_engine(monkeypatch, engine)
    yield engine
    engine.dispose()


@pytest.fixture()
def database_hung(monkeypatch, black_hole):
    """Accepts the TCP connection, never completes the handshake."""
    engine = create_engine(
        f"postgresql+psycopg2://t:t@127.0.0.1:{black_hole.port}/t",
        connect_args={"connect_timeout": 2},
    )
    _use_engine(monkeypatch, engine)
    yield engine
    engine.dispose()


def _assert_unavailable(response):
    assert response.status_code == 503, response.get_data(as_text=True)[:300]
    body = response.get_json()
    assert body["error"] == "service_unavailable"
    assert body["details"]["dependency"] == "database"
    assert response.headers.get("Retry-After")
    assert "Traceback" not in response.get_data(as_text=True)


@pytest.mark.parametrize("path", ["/api/me", "/notifications/counts", "/favorites", "/dashboard/summary"])
def test_database_down_is_a_503_not_a_500(client, signed_in, database_down, path):
    with Stopwatch() as watch:
        response = client.get(f"{PREFIX}{path}", headers=signed_in)
    _assert_unavailable(response)
    assert watch.seconds < 5


def test_database_down_on_a_write_is_a_503(client, signed_in, database_down):
    response = client.post(f"{PREFIX}/api/explorer/query", headers=signed_in, json={"resource_type": "task"})
    _assert_unavailable(response)


def test_a_hung_database_answers_within_the_connect_timeout(client, signed_in, database_hung):
    with Stopwatch() as watch:
        response = client.get(f"{PREFIX}/favorites", headers=signed_in)
    _assert_unavailable(response)
    assert watch.seconds < 8, f"a hung database held the request for {watch.seconds:.1f}s"


def test_liveness_survives_and_readiness_reports_the_outage(client, database_down):
    assert client.get(f"{PREFIX}/health/live").status_code == 200
    ready = client.get(f"{PREFIX}/health/ready")
    assert ready.status_code == 503
    assert "Traceback" not in ready.get_data(as_text=True)


def test_an_unauthenticated_request_is_still_a_401(client, database_down):
    """No token is refused before the database is ever consulted."""
    assert client.get(f"{PREFIX}/api/me").status_code == 401


@pytest.mark.database
def test_an_exhausted_pool_is_a_503_after_the_pool_timeout(client, signed_in, monkeypatch, engine):
    """Every connection busy: wait `pool_timeout`, then 503 — not a hang, not a 500."""
    tiny = create_engine(engine.url.render_as_string(hide_password=False), pool_size=1, max_overflow=0,
                         pool_timeout=1)
    _use_engine(monkeypatch, tiny)
    held = tiny.connect()
    try:
        with Stopwatch() as watch:
            response = client.get(f"{PREFIX}/favorites", headers=signed_in)
        _assert_unavailable(response)
        assert watch.seconds < 4
    finally:
        held.close()
        tiny.dispose()


@pytest.mark.database
def test_a_slow_database_is_slower_not_broken(client, signed_in, engine):
    """30 ms added to every statement: answers stay correct, only later."""
    import time

    def _slow(*_args, **_kwargs):
        time.sleep(0.03)

    event.listen(engine, "before_cursor_execute", _slow)
    try:
        with Stopwatch() as watch:
            response = client.get(f"{PREFIX}/notifications/counts", headers=signed_in)
        assert response.status_code == 200
        assert watch.seconds >= 0.1  # the delay really applied
    finally:
        event.remove(engine, "before_cursor_execute", _slow)
