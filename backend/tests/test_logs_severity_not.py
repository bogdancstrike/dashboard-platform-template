"""The system log: the sink that writes it and the viewer that reads it (§22). — severity, not equality."""

from __future__ import annotations

import uuid

import pytest

from src.core import vocabulary
from src.core.clock import now
from src.core.errors import ValidationError
from src.services.platform import system_logs as service
from tests.logs_support import (  # noqa: F401
    LOGS,
    _authenticate,
    _line,
    pytestmark,
)


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
