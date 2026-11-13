"""The calendar (§19). — The expander."""

from __future__ import annotations

from datetime import datetime, timedelta

from src.services.work import calendar as service
from tests.calendar_support import (  # noqa: F401
    UTC,
    _Event,
    _starts,
)


def test_a_single_event_appears_once_when_it_overlaps_the_window():
    event = _Event(datetime(2026, 3, 10, 9, tzinfo=UTC), datetime(2026, 3, 10, 10, tzinfo=UTC))
    found = service._expand(
        event, datetime(2026, 3, 1, tzinfo=UTC), datetime(2026, 4, 1, tzinfo=UTC)
    )
    assert _starts(found) == ["2026-03-10"]


def test_an_event_that_ends_inside_the_window_is_in_it():
    """A meeting that began before the window still belongs to it.

    The case a naive `starts_at BETWEEN` filter gets wrong, and the one a
    reader notices: an all-morning workshop vanishes from the day view of the
    day it finishes.
    """
    event = _Event(datetime(2026, 3, 9, 23, tzinfo=UTC), datetime(2026, 3, 10, 2, tzinfo=UTC))
    found = service._expand(
        event, datetime(2026, 3, 10, tzinfo=UTC), datetime(2026, 3, 11, tzinfo=UTC)
    )
    assert len(found) == 1


def test_a_daily_series_yields_one_occurrence_a_day():
    event = _Event(
        datetime(2026, 3, 2, 9, tzinfo=UTC),
        datetime(2026, 3, 2, 9, 30, tzinfo=UTC),
        {"freq": "DAILY", "interval": 1},
        datetime(2026, 3, 6, 9, tzinfo=UTC),
    )
    found = service._expand(
        event, datetime(2026, 3, 1, tzinfo=UTC), datetime(2026, 4, 1, tzinfo=UTC)
    )
    assert _starts(found) == ["2026-03-02", "2026-03-03", "2026-03-04", "2026-03-05", "2026-03-06"]


def test_a_weekly_series_lands_on_every_named_day():
    """The claim the whole module exists for, stated exactly."""
    event = _Event(
        datetime(2026, 3, 2, 9, tzinfo=UTC),  # a Monday
        datetime(2026, 3, 2, 10, tzinfo=UTC),
        {"freq": "WEEKLY", "interval": 1, "byday": ["TU", "TH"]},
        datetime(2026, 3, 20, tzinfo=UTC),
    )
    found = service._expand(
        event, datetime(2026, 3, 1, tzinfo=UTC), datetime(2026, 3, 31, tzinfo=UTC)
    )
    assert _starts(found) == [
        "2026-03-03", "2026-03-05",
        "2026-03-10", "2026-03-12",
        "2026-03-17", "2026-03-19",
    ]


def test_a_fortnightly_series_skips_the_weeks_between():
    event = _Event(
        datetime(2026, 3, 2, 9, tzinfo=UTC),
        datetime(2026, 3, 2, 10, tzinfo=UTC),
        {"freq": "WEEKLY", "interval": 2, "byday": ["MO"]},
        datetime(2026, 4, 30, tzinfo=UTC),
    )
    found = service._expand(
        event, datetime(2026, 3, 1, tzinfo=UTC), datetime(2026, 4, 1, tzinfo=UTC)
    )
    assert _starts(found) == ["2026-03-02", "2026-03-16", "2026-03-30"]


def test_a_weekly_series_without_named_days_repeats_on_its_own_weekday():
    event = _Event(
        datetime(2026, 3, 4, 9, tzinfo=UTC),  # a Wednesday
        datetime(2026, 3, 4, 10, tzinfo=UTC),
        {"freq": "WEEKLY", "interval": 1},
        datetime(2026, 3, 25, tzinfo=UTC),
    )
    found = service._expand(
        event, datetime(2026, 3, 1, tzinfo=UTC), datetime(2026, 3, 31, tzinfo=UTC)
    )
    assert _starts(found) == ["2026-03-04", "2026-03-11", "2026-03-18"]


def test_a_monthly_series_on_the_31st_skips_the_months_that_have_no_31st():
    """It does not silently become the 1st of the next month.

    Which is what a naive "add 31 days" or a clamp to the month's length would
    do — and a series that lands on a different day from the one somebody
    chose is a series they stop trusting.
    """
    event = _Event(
        datetime(2026, 1, 31, 9, tzinfo=UTC),
        datetime(2026, 1, 31, 10, tzinfo=UTC),
        {"freq": "MONTHLY", "interval": 1},
        datetime(2026, 6, 1, tzinfo=UTC),
    )
    found = service._expand(
        event, datetime(2026, 1, 1, tzinfo=UTC), datetime(2026, 6, 1, tzinfo=UTC)
    )
    # No February, no April: neither has a 31st.
    assert _starts(found) == ["2026-01-31", "2026-03-31", "2026-05-31"]


def test_a_window_that_begins_mid_series_starts_where_it_should():
    event = _Event(
        datetime(2026, 1, 5, 9, tzinfo=UTC),
        datetime(2026, 1, 5, 10, tzinfo=UTC),
        {"freq": "WEEKLY", "interval": 1, "byday": ["MO"]},
        datetime(2026, 12, 31, tzinfo=UTC),
    )
    found = service._expand(
        event, datetime(2026, 3, 9, tzinfo=UTC), datetime(2026, 3, 23, tzinfo=UTC)
    )
    assert _starts(found) == ["2026-03-09", "2026-03-16"]


def test_a_series_never_starts_before_its_first_occurrence():
    """The weekly walk begins at the Monday of the first week, so a series that
    starts on a Wednesday must not yield that week's Monday."""
    event = _Event(
        datetime(2026, 3, 4, 9, tzinfo=UTC),  # Wednesday
        datetime(2026, 3, 4, 10, tzinfo=UTC),
        {"freq": "WEEKLY", "interval": 1, "byday": ["MO", "WE"]},
        datetime(2026, 3, 18, tzinfo=UTC),
    )
    found = service._expand(
        event, datetime(2026, 3, 1, tzinfo=UTC), datetime(2026, 3, 31, tzinfo=UTC)
    )
    assert _starts(found) == ["2026-03-04", "2026-03-09", "2026-03-11", "2026-03-16"]


def test_a_series_stops_at_its_horizon():
    event = _Event(
        datetime(2026, 3, 2, 9, tzinfo=UTC),
        datetime(2026, 3, 2, 10, tzinfo=UTC),
        {"freq": "DAILY", "interval": 1},
        datetime(2026, 3, 4, 9, tzinfo=UTC),
    )
    found = service._expand(
        event, datetime(2026, 3, 1, tzinfo=UTC), datetime(2026, 4, 1, tzinfo=UTC)
    )
    assert _starts(found) == ["2026-03-02", "2026-03-03", "2026-03-04"]


def test_a_rule_the_expander_cannot_read_still_shows_the_event_once():
    """Wrong in a small way beats wrong in the way that loses a meeting.

    A `freq` this module does not understand could reasonably produce nothing —
    and then an event somebody created is simply absent from their calendar,
    with no error anywhere.
    """
    event = _Event(
        datetime(2026, 3, 10, 9, tzinfo=UTC),
        datetime(2026, 3, 10, 10, tzinfo=UTC),
        {"freq": "FORTNIGHTLY-ISH", "interval": 1},
        datetime(2026, 12, 1, tzinfo=UTC),
    )
    found = service._expand(
        event, datetime(2026, 3, 1, tzinfo=UTC), datetime(2026, 4, 1, tzinfo=UTC)
    )
    assert _starts(found) == ["2026-03-10"]


def test_every_occurrence_keeps_the_events_own_duration():
    event = _Event(
        datetime(2026, 3, 2, 9, tzinfo=UTC),
        datetime(2026, 3, 2, 10, 30, tzinfo=UTC),
        {"freq": "DAILY", "interval": 1},
        datetime(2026, 3, 5, tzinfo=UTC),
    )
    found = service._expand(
        event, datetime(2026, 3, 1, tzinfo=UTC), datetime(2026, 4, 1, tzinfo=UTC)
    )
    assert {item.ends_at - item.starts_at for item in found} == {timedelta(minutes=90)}


def test_an_occurrence_id_names_its_series_and_its_moment():
    event = _Event(datetime(2026, 3, 10, 9, tzinfo=UTC), datetime(2026, 3, 10, 10, tzinfo=UTC))
    occurrence = service._expand(
        event, datetime(2026, 3, 1, tzinfo=UTC), datetime(2026, 4, 1, tzinfo=UTC)
    )[0]
    series, _, moment = occurrence.id.partition(":")
    assert series == event.id
    assert moment.startswith("2026-03-10T09:00")
