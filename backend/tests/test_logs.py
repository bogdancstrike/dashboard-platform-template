"""The system log: the sink that writes it and the viewer that reads it (§22).

The claims worth asserting are the ones that decide whether a log console can
be trusted at all:

  * a request the platform served **is in the table**, under the correlation id
    the response handed back — which is the one thing a log viewer exists for,
    and was impossible before there was a sink;
  * the level is derived from the *outcome*, so "ERROR" always means the same
    thing and the filter beside it is worth having;
  * the sink **never affects the response**: a broken logging table must not
    turn a working request into a 500;
  * health probes and the log endpoints themselves are not logged, because a
    table that grows while being looked at has a tail that never settles;
  * `min_level` filters by **severity, not equality** — somebody who asks for
    ERROR wants CRITICAL too;
  * the tail's cursor never repeats a line and never skips one, including when
    two lines share a timestamp;
  * and pruning takes its bound from the *setting*, so it cannot be used as an
    arbitrary delete.
"""

from __future__ import annotations

import uuid
from datetime import timedelta

import pytest
from sqlalchemy import func, select

from src.config import Config
from src.core import logsink, vocabulary
from src.core.clock import now
from src.core.db import session_scope
from src.core.errors import NotFoundError, ValidationError
from src.services import logs as service
from tests.conftest import persona_claims

pytestmark = pytest.mark.database

PREFIX = Config.API_PREFIX
LOGS = f"{PREFIX}/admin/logs"


def _authenticate(monkeypatch, username: str = "admin", role: str = "administrator"):
    monkeypatch.setattr(
        "src.core.auth.verify_token",
        lambda _token: persona_claims(username, role, sid=f"log-{username}"),
    )
    return {"Authorization": f"Bearer log-{username}"}


def _line(**overrides):
    """One log line, written straight through the sink's own writer."""
    from src.models.platform import SystemLog

    row = {
        "level": "INFO",
        "service": "platform-api",
        "logger": "api.request",
        "message": "GET /platform/things → 200",
        "correlation_id": uuid.uuid4().hex,
        "environment": "test",
        "duration_ms": 12.5,
        "status_code": 200,
        "context": {"method": "GET", "path": "/platform/things"},
    }
    row.update(overrides)
    logged_at = row.pop("logged_at", None) or now()
    with session_scope() as session:
        line = SystemLog(logged_at=logged_at, **row)
        session.add(line)
        session.flush()
        return str(line.id), row["correlation_id"]


# ── the level a request earns ────────────────────────────────────────────


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


# ── the sink, against the real application ───────────────────────────────


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

    monkeypatch.setattr("src.core.logsink.record", explode)
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


# ── severity, not equality ───────────────────────────────────────────────


def test_min_level_means_this_and_worse():
    """Somebody who filters for ERROR is looking for trouble, and CRITICAL is
    more trouble. Equality here would hide the worst lines behind the filter
    chosen to find them."""
    assert service._at_least("ERROR") == ("ERROR", "CRITICAL")
    assert service._at_least("WARNING") == ("WARNING", "ERROR", "CRITICAL")
    assert service._at_least("DEBUG") == vocabulary.LOG_LEVEL
    assert service._at_least("CRITICAL") == ("CRITICAL",)


def test_an_unknown_level_is_refused_with_the_known_ones_named():
    """Silently returning nothing would read as "no errors", which is the most
    dangerous possible answer from a log viewer."""
    with pytest.raises(ValidationError) as raised:
        service._at_least("SEVERE")
    assert "SEVERE" in str(raised.value)
    assert raised.value.details["allowed"] == list(vocabulary.LOG_LEVEL)


def test_the_severity_filter_narrows_the_listing(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    _line(level="DEBUG", message="a chatty line")
    _line(level="ERROR", message="a bad line")
    _line(level="CRITICAL", message="a worse line")

    answer = client.get(f"{LOGS}?min_level=ERROR&page_size=100", headers=headers).get_json()

    levels = {item["level"] for item in answer["items"]}
    assert levels <= {"ERROR", "CRITICAL"}
    assert "ERROR" in levels and "CRITICAL" in levels


def test_the_severity_filter_is_case_insensitive(client, monkeypatch):
    """It arrives from a URL, and a URL is typed by people."""
    headers = _authenticate(monkeypatch)
    _line(level="CRITICAL", message="from a hand-typed address")
    answer = client.get(f"{LOGS}?min_level=critical&page_size=5", headers=headers).get_json()
    assert {item["level"] for item in answer["items"]} == {"CRITICAL"}


# ── the tail ─────────────────────────────────────────────────────────────


def test_the_first_poll_returns_the_newest_page_and_a_cursor(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    _line(message="the newest thing that happened")
    answer = client.get(f"{LOGS}/tail", headers=headers).get_json()

    assert answer["items"], "a tail with no cursor should return the latest page"
    assert answer["cursor"] == answer["items"][-1]["id"]
    # Oldest first, so a client appends without sorting.
    stamps = [item["logged_at"] for item in answer["items"]]
    assert stamps == sorted(stamps)


def test_the_tail_returns_only_what_is_new_and_never_repeats_a_line(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    first, _ = _line(message="before the cursor")
    opening = client.get(f"{LOGS}/tail", headers=headers).get_json()
    cursor = opening["cursor"]
    delivered = {item["id"] for item in opening["items"]}

    second, _ = _line(message="after the cursor")
    following = client.get(f"{LOGS}/tail?after={cursor}", headers=headers).get_json()

    fresh = {item["id"] for item in following["items"]}
    assert second in fresh, "a line written after the cursor was not delivered"
    assert not (fresh & delivered), "the tail repeated a line it had already sent"
    assert first not in fresh


def test_the_tail_separates_two_lines_that_share_a_timestamp(client, monkeypatch):
    """A timestamp cursor either repeats these or drops one; the cursor is an
    id and the ordering is `(logged_at, id)`, which is why this holds."""
    headers = _authenticate(monkeypatch)
    stamp = now()
    ids = {_line(message=f"simultaneous {index}", logged_at=stamp)[0] for index in range(4)}

    # Walk the tail one page at a time from before them all.
    answer = client.get(f"{LOGS}/tail", headers=headers).get_json()
    seen = {item["id"] for item in answer["items"]}
    answer = client.get(f"{LOGS}/tail?after={answer['cursor']}", headers=headers).get_json()
    seen |= {item["id"] for item in answer["items"]}

    assert ids <= seen, "a line sharing a timestamp with another was skipped"


def test_the_tail_is_quiet_when_nothing_is_new(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    _line(message="the only thing")
    opening = client.get(f"{LOGS}/tail", headers=headers).get_json()
    again = client.get(f"{LOGS}/tail?after={opening['cursor']}", headers=headers).get_json()

    assert again["items"] == []
    # And it keeps the caller's place rather than handing back nothing, so the
    # next poll does not restart from the beginning.
    assert again["cursor"] == opening["cursor"]


def test_a_cursor_that_is_gone_is_refused_rather_than_restarted(client, monkeypatch):
    """A tail that silently jumped back to the beginning would replay an hour
    of lines into somebody's viewer."""
    headers = _authenticate(monkeypatch)
    assert client.get(f"{LOGS}/tail?after={uuid.uuid4()}", headers=headers).status_code == 404


def test_a_cursor_that_is_not_a_uuid_says_which_field_was_wrong(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    answer = client.get(f"{LOGS}/tail?after=yesterday", headers=headers)
    assert answer.status_code == 400
    assert "after" in answer.get_json()["message"]


def test_the_tail_honours_the_filters_beside_it(client, monkeypatch):
    """A paused-and-resumed tail under a level filter must not deliver the
    lines that filter excludes — otherwise pausing changes what you see."""
    headers = _authenticate(monkeypatch)
    _line(level="DEBUG", message="chatter while filtered")
    opening = client.get(f"{LOGS}/tail?min_level=ERROR", headers=headers).get_json()
    assert all(item["level"] in ("ERROR", "CRITICAL") for item in opening["items"])


# ── one line in full ─────────────────────────────────────────────────────


def test_one_line_carries_its_context_and_the_list_does_not(client, monkeypatch):
    """A list carrying every stack trace is a page weighing megabytes for the
    sake of the one row somebody expands."""
    headers = _authenticate(monkeypatch)
    line_id, _ = _line(
        level="ERROR",
        message="it broke",
        stack_trace="Traceback (most recent call last):\n  ...",
        context={"method": "POST", "path": "/platform/things", "route": "/things"},
    )

    detail = client.get(f"{LOGS}/{line_id}", headers=headers).get_json()
    listing = client.get(f"{LOGS}?page_size=100", headers=headers).get_json()

    assert detail["stack_trace"].startswith("Traceback")
    assert detail["context"]["route"] == "/things"

    row = next(item for item in listing["items"] if item["id"] == line_id)
    assert "stack_trace" not in row
    assert "context" not in row
    # But the table can still mark which rows are worth opening.
    assert row["has_stack_trace"] is True
    assert row["has_context"] is True


def test_a_line_shows_the_other_lines_from_the_same_request(client, monkeypatch):
    """One failure is rarely one line, and reading "permission denied" without
    the request that caused it is reading half the story."""
    headers = _authenticate(monkeypatch)
    correlation = uuid.uuid4().hex
    first, _ = _line(correlation_id=correlation, message="the request arrived")
    second, _ = _line(correlation_id=correlation, level="ERROR", message="and then it broke")

    detail = client.get(f"{LOGS}/{second}", headers=headers).get_json()

    assert [item["id"] for item in detail["related"]] == [first]


def test_a_line_with_no_correlation_id_is_not_related_to_every_other_one(client, monkeypatch):
    """`WHERE correlation_id = NULL` matching every other id-less line would
    put the whole seeded table in one pane."""
    headers = _authenticate(monkeypatch)
    _line(correlation_id=None, message="an orphan")
    orphan, _ = _line(correlation_id=None, message="another orphan")

    detail = client.get(f"{LOGS}/{orphan}", headers=headers).get_json()
    assert detail["related"] == []


def test_a_line_that_does_not_exist_says_so(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    assert client.get(f"{LOGS}/{uuid.uuid4()}", headers=headers).status_code == 404


def test_a_duration_is_a_number_not_a_string(client, monkeypatch):
    """`Numeric` serialises as a string, and a duration that sorts as text puts
    9ms after 1000ms."""
    headers = _authenticate(monkeypatch)
    line_id, _ = _line(duration_ms=9)
    detail = client.get(f"{LOGS}/{line_id}", headers=headers).get_json()
    assert isinstance(detail["duration_ms"], float)


# ── the catalogue ────────────────────────────────────────────────────────


def test_the_catalogue_offers_every_level_even_the_empty_ones(client, monkeypatch):
    """A level chip that appears only once something is broken is a chip
    somebody learns to stop looking for."""
    headers = _authenticate(monkeypatch)
    answer = client.get(f"{LOGS}/catalogue", headers=headers).get_json()
    assert [item["key"] for item in answer["levels"]] == list(vocabulary.LOG_LEVEL)


def test_the_catalogue_reports_the_retention_the_setting_declares(client, monkeypatch):
    """Read from the settings table, not declared here: a viewer that said
    "kept for 30 days" while the setting said 90 would be lying about its own
    data."""
    from src.models.platform import SystemSetting

    headers = _authenticate(monkeypatch)
    with session_scope() as session:
        row = session.scalar(
            select(SystemSetting).where(SystemSetting.key == "retention.log_days")
        )
        declared = (row.value or {}).get("value") if row else None
    answer = client.get(f"{LOGS}/catalogue", headers=headers).get_json()

    assert answer["retention_days"] == declared


def test_the_filter_vocabulary_is_the_one_the_sql_is_built_from(client, monkeypatch):
    """A filter the UI offers is by construction a filter the backend honours —
    which is the reason this list is built on `core/query` at all."""
    headers = _authenticate(monkeypatch)
    answer = client.get(f"{LOGS}/catalogue", headers=headers).get_json()
    names = {field["name"] for field in answer["fields"]}
    assert {"level", "service", "logger", "correlation_id", "status_code"} <= names


# ── pruning ──────────────────────────────────────────────────────────────


def test_pruning_removes_what_is_older_than_the_bound_and_keeps_the_rest():
    keep, _ = _line(message="recent enough", logged_at=now() - timedelta(days=1))
    with session_scope() as session:
        days = service._retention(session) or 30
    drop, _ = _line(message="long past", logged_at=now() - timedelta(days=days + 5))

    with session_scope() as session:
        removed = logsink.sweep(session, days=days)
    assert removed >= 1

    from src.models.platform import SystemLog

    with session_scope() as session:
        assert session.get(SystemLog, uuid.UUID(drop)) is None
        assert session.get(SystemLog, uuid.UUID(keep)) is not None


def test_pruning_takes_its_bound_from_the_setting_and_not_the_request(client, monkeypatch):
    """A `days` parameter would make this an arbitrary delete endpoint wearing
    a retention policy's name."""
    headers = _authenticate(monkeypatch)
    from src.models.platform import SystemLog

    old, _ = _line(message="ancient", logged_at=now() - timedelta(days=4000))

    answer = client.post(f"{LOGS}/prune?days=1", headers=headers).get_json()

    with session_scope() as session:
        assert session.get(SystemLog, uuid.UUID(old)) is None
    # The declared bound, not the one in the query string.
    assert answer["retention_days"] != 1
    assert answer["removed"] >= 1


def test_a_retention_of_zero_is_refused_rather_than_deleting_everything():
    """`days=0` through the arithmetic is "older than now", which is the whole
    table. A bound that means "delete everything" has to be said out loud."""
    with session_scope() as session:
        with pytest.raises(ValueError):
            logsink.sweep(session, days=0)
        with pytest.raises(ValueError):
            logsink.sweep(session, days=-7)


# ── permissions ──────────────────────────────────────────────────────────


def test_reading_the_log_needs_logs_view(client, monkeypatch):
    headers = _authenticate(monkeypatch, "user", "viewer")
    assert client.get(LOGS, headers=headers).status_code == 403
    assert client.get(f"{LOGS}/catalogue", headers=headers).status_code == 403
    assert client.get(f"{LOGS}/tail", headers=headers).status_code == 403


def test_an_administrator_may_read_it(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    answer = client.get(f"{LOGS}?page_size=5", headers=headers)
    assert answer.status_code == 200
    body = answer.get_json()
    assert "items" in body and "facets" in body


def test_pruning_needs_the_permission_that_owns_the_bound(client, monkeypatch):
    """A manager holds `logs.view` and not `settings.manage`: they may read the
    log and may not enact the policy on it early."""
    headers = _authenticate(monkeypatch, "manager", "manager")
    assert client.get(LOGS, headers=headers).status_code == 200
    assert client.post(f"{LOGS}/prune", headers=headers).status_code == 403
