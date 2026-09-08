"""The calendar (§19).

Two halves, deliberately.

The recurrence expander is a **pure function over a window**, and it is tested
as one: "every second Tuesday, for a month" is a claim you can state exactly,
and driving it through HTTP would only add ways for the assertion to be about
something else. Its edge cases are the ones that lose somebody's meeting — a
monthly series on the 31st, a window that begins mid-series, a rule the
expander cannot read.

Everything else is tested through the API, because that is where the rules
about *who* live: only the organiser edits, only you answer your own
invitation, and a window is a required range rather than "everything".
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from src.config import Config
from src.core.db import session_scope
from src.services import calendar as service
from tests.conftest import persona_claims

PREFIX = Config.API_PREFIX
EVENTS = f"{PREFIX}/api/calendar/events"

UTC = timezone.utc


def _authenticate(monkeypatch, username: str = "admin", role: str = "administrator"):
    monkeypatch.setattr(
        "src.core.auth.verify_token",
        lambda _token: persona_claims(username, role, sid=f"cal-{username}"),
    )
    return {"Authorization": f"Bearer cal-{username}"}


class _Event:
    """The smallest thing `_expand` reads, so the expander can be tested alone.

    A stand-in rather than a real row: the expander only ever touches five
    attributes, and building an ORM object (with an organisation, an organiser
    and a flush) to assert "the 31st skips February" would put a database
    between the claim and the code that makes it.
    """

    def __init__(self, starts, ends, recurrence=None, until=None):
        self.id = "11111111-1111-1111-1111-111111111111"
        self.title = "Series"
        self.starts_at = starts
        self.ends_at = ends
        self.recurrence = recurrence
        self.recurrence_until = until
        self.all_day = False
        self.status = "CONFIRMED"
        self.category = "MEETING"
        self.organizer_id = None
        self.participants = None


def _starts(occurrences) -> list[str]:
    return [item.starts_at.date().isoformat() for item in occurrences]


# ── The expander ─────────────────────────────────────────────────────────


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


# ── The repeat, in words ─────────────────────────────────────────────────


def test_a_repeat_is_described_by_the_module_that_expands_it():
    """So the sentence a reader checks against cannot disagree with the grid."""
    assert service.describe({"freq": "WEEKLY", "interval": 1, "byday": ["TU", "TH"]}) == (
        "every week on Tuesday and Thursday"
    )
    assert service.describe({"freq": "WEEKLY", "interval": 2, "byday": ["MO"]}) == (
        "every second week on Monday"
    )
    assert service.describe({"freq": "DAILY", "interval": 1}) == "every day"
    assert service.describe({"freq": "MONTHLY", "interval": 3}) == "every third month"
    assert service.describe(None) == ""
    assert service.describe({"freq": "HOURLY"}) == ""


def test_a_described_repeat_names_its_horizon():
    text = service.describe(
        {"freq": "DAILY", "interval": 1}, datetime(2026, 6, 3, tzinfo=UTC)
    )
    assert text == "every day, until 2026-06-03"


# ── Clashes ──────────────────────────────────────────────────────────────


def _occurrence(title: str, start: datetime, minutes: int, *, user, all_day=False):
    event = _Event(start, start + timedelta(minutes=minutes))
    event.title = title
    event.all_day = all_day
    event.participants = [{"user_id": str(user), "response": "ACCEPTED"}]
    return service.Occurrence(event, start, start + timedelta(minutes=minutes))


def test_two_of_my_overlapping_events_name_each_other():
    from uuid import uuid4

    me = uuid4()
    first = _occurrence("Design review", datetime(2026, 3, 10, 9, tzinfo=UTC), 60, user=me)
    second = _occurrence("Standup", datetime(2026, 3, 10, 9, 30, tzinfo=UTC), 30, user=me)

    clashes = service._clashes([first, second], me)
    # Named, not counted: "clashes with the Design review" is actionable and
    # "1 clash" sends somebody hunting for it.
    assert clashes[first.id] == ("Standup",)
    assert clashes[second.id] == ("Design review",)


def test_events_that_merely_touch_do_not_clash():
    from uuid import uuid4

    me = uuid4()
    first = _occurrence("Earlier", datetime(2026, 3, 10, 9, tzinfo=UTC), 60, user=me)
    second = _occurrence("Later", datetime(2026, 3, 10, 10, tzinfo=UTC), 30, user=me)
    assert service._clashes([first, second], me) == {}


def test_an_all_day_marker_is_not_a_double_booking():
    """A public holiday overlapping every meeting in it would flag the week."""
    from uuid import uuid4

    me = uuid4()
    holiday = _occurrence(
        "Public holiday", datetime(2026, 3, 10, tzinfo=UTC), 60 * 24, user=me, all_day=True
    )
    meeting = _occurrence("Standup", datetime(2026, 3, 10, 9, tzinfo=UTC), 30, user=me)
    assert service._clashes([holiday, meeting], me) == {}


def test_a_clash_is_a_fact_about_a_reader_and_not_about_a_pair():
    from uuid import uuid4

    me, somebody = uuid4(), uuid4()
    theirs = _occurrence("Their review", datetime(2026, 3, 10, 9, tzinfo=UTC), 60, user=somebody)
    also_theirs = _occurrence("Their standup", datetime(2026, 3, 10, 9, 30, tzinfo=UTC), 30, user=somebody)
    # Two events overlapping in somebody else's week are none of my business.
    assert service._clashes([theirs, also_theirs], me) == {}


# ── Through the API ──────────────────────────────────────────────────────

pytestmark_db = pytest.mark.database


@pytest.mark.database
def test_the_calendar_endpoints_need_a_bearer_token(client):
    assert client.get(EVENTS).status_code == 401


@pytest.mark.database
def test_a_window_is_a_required_range(client, monkeypatch):
    """Not defaulted to "everything": that answer expands every series the
    database holds to draw one month."""
    headers = _authenticate(monkeypatch)
    response = client.get(EVENTS, headers=headers)
    assert response.status_code == 400
    assert "from" in response.get_json()["message"]


@pytest.mark.database
def test_a_window_wider_than_the_cap_is_refused_with_the_reason(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    response = client.get(
        f"{EVENTS}?from=2020-01-01&to=2030-01-01", headers=headers
    )
    assert response.status_code == 400
    body = response.get_json()
    assert "at most" in body["message"]
    assert body["details"]["days"] > service.MAX_WINDOW_DAYS


@pytest.mark.database
def test_a_backwards_window_is_refused(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    response = client.get(f"{EVENTS}?from=2026-04-01&to=2026-03-01", headers=headers)
    assert response.status_code == 400


@pytest.mark.database
def test_a_month_of_the_seeded_calendar_answers_with_its_own_totals(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    answer = client.get(f"{EVENTS}?from=2026-08-01&to=2026-10-01", headers=headers).get_json()

    assert answer["total"] == len(answer["items"])
    assert answer["counts"]["total"] == answer["total"]
    # Computed over the window rather than over a page: a calendar is not
    # paginated (§44).
    assert sum(answer["counts"]["by_category"].values()) == answer["total"]
    assert answer["categories"], "the editor renders its choices from this"


@pytest.mark.database
def test_a_created_event_appears_in_the_window_it_falls_in(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    created = client.post(
        EVENTS,
        json={
            "title": "Calendar test — one off",
            "category": "REVIEW",
            "starts_at": "2027-05-10T09:00:00+00:00",
            "ends_at": "2027-05-10T10:00:00+00:00",
        },
        headers=headers,
    )
    assert created.status_code == 201, created.get_data(as_text=True)

    answer = client.get(f"{EVENTS}?from=2027-05-01&to=2027-06-01", headers=headers).get_json()
    titles = [item["title"] for item in answer["items"]]
    assert "Calendar test — one off" in titles

    # And not in a neighbouring month.
    other = client.get(f"{EVENTS}?from=2027-06-01&to=2027-07-01", headers=headers).get_json()
    assert "Calendar test — one off" not in [item["title"] for item in other["items"]]


@pytest.mark.database
def test_a_created_series_is_expanded_by_the_server(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    created = client.post(
        EVENTS,
        json={
            "title": "Calendar test — weekly",
            "starts_at": "2027-05-03T09:00:00+00:00",
            "ends_at": "2027-05-03T09:30:00+00:00",
            "recurrence": {"freq": "WEEKLY", "interval": 1, "byday": ["MO"]},
            "recurrence_until": "2027-05-31T00:00:00+00:00",
        },
        headers=headers,
    ).get_json()
    assert created["recurrence_text"] == "every week on Monday, until 2027-05-31"

    answer = client.get(f"{EVENTS}?from=2027-05-01&to=2027-06-01", headers=headers).get_json()
    mine = [item for item in answer["items"] if item["title"] == "Calendar test — weekly"]
    assert [item["day"] for item in mine] == [
        "2027-05-03", "2027-05-10", "2027-05-17", "2027-05-24",
    ]
    # Each occurrence names its series, and says it is one.
    assert {item["event_id"] for item in mine} == {created["id"]}
    assert all(item["is_occurrence"] for item in mine)


@pytest.mark.database
def test_a_repeat_the_expander_cannot_read_is_refused_on_write(client, monkeypatch):
    """Because a rule it cannot read produces a series nobody ever sees."""
    headers = _authenticate(monkeypatch)
    response = client.post(
        EVENTS,
        json={
            "title": "Calendar test — bad rule",
            "starts_at": "2027-05-03T09:00:00+00:00",
            "ends_at": "2027-05-03T09:30:00+00:00",
            "recurrence": {"freq": "HOURLY"},
        },
        headers=headers,
    )
    assert response.status_code == 400
    assert "daily, weekly or monthly" in response.get_json()["message"]


@pytest.mark.database
def test_an_event_has_to_end_after_it_starts(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    response = client.post(
        EVENTS,
        json={
            "title": "Calendar test — backwards",
            "starts_at": "2027-05-03T10:00:00+00:00",
            "ends_at": "2027-05-03T09:00:00+00:00",
        },
        headers=headers,
    )
    assert response.status_code == 400
    assert "end after it starts" in response.get_json()["message"]


@pytest.mark.database
def test_the_organiser_is_a_participant_and_has_accepted(client, monkeypatch):
    """Somebody who called the meeting has plainly said they are coming."""
    headers = _authenticate(monkeypatch)
    created = client.post(
        EVENTS,
        json={
            "title": "Calendar test — organiser",
            "starts_at": "2027-05-04T09:00:00+00:00",
            "ends_at": "2027-05-04T10:00:00+00:00",
        },
        headers=headers,
    ).get_json()

    assert created["involves_me"] is True
    assert created["my_response"] == "ACCEPTED"


@pytest.mark.database
def test_a_new_invitation_starts_unanswered_rather_than_accepted(client, monkeypatch):
    """"Has not looked yet" and "agreed to come" are different facts."""
    headers = _authenticate(monkeypatch)

    from src.models.identity import User

    with session_scope() as session:
        somebody = session.scalars(
            select(User).where(User.username == "manager")
        ).first()
        assert somebody is not None
        invitee = str(somebody.id)

    created = client.post(
        EVENTS,
        json={
            "title": "Calendar test — invitation",
            "starts_at": "2027-05-05T09:00:00+00:00",
            "ends_at": "2027-05-05T10:00:00+00:00",
            "participants": [{"user_id": invitee}],
        },
        headers=headers,
    ).get_json()

    theirs = [item for item in created["participants"] if item["user_id"] == invitee]
    assert theirs and theirs[0]["response"] == "NEEDS_ACTION"


@pytest.mark.database
def test_only_you_answer_your_own_invitation(client, monkeypatch):
    """An organiser accepting on somebody's behalf turns an attendance list
    into a guess, which is worse than an empty one."""
    headers = _authenticate(monkeypatch)

    from src.models.identity import User

    with session_scope() as session:
        manager = session.scalars(select(User).where(User.username == "manager")).first()
        invitee = str(manager.id)

    created = client.post(
        EVENTS,
        json={
            "title": "Calendar test — respond",
            "starts_at": "2027-05-06T09:00:00+00:00",
            "ends_at": "2027-05-06T10:00:00+00:00",
            "participants": [{"user_id": invitee}],
        },
        headers=headers,
    ).get_json()

    # The organiser answers, and answers only for themselves.
    mine = client.post(
        f"{EVENTS}/{created['id']}/respond", json={"response": "TENTATIVE"}, headers=headers
    )
    assert mine.status_code == 200
    body = mine.get_json()
    assert body["my_response"] == "TENTATIVE"
    theirs = [item for item in body["participants"] if item["user_id"] == invitee]
    assert theirs[0]["response"] == "NEEDS_ACTION", "the invitee's answer is not the organiser's"

    # And the invitee answers for themselves, through the same endpoint.
    as_manager = _authenticate(monkeypatch, "manager", "manager")
    answered = client.post(
        f"{EVENTS}/{created['id']}/respond", json={"response": "ACCEPTED"}, headers=as_manager
    ).get_json()
    assert answered["my_response"] == "ACCEPTED"


@pytest.mark.database
def test_somebody_who_was_not_invited_cannot_answer(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    created = client.post(
        EVENTS,
        json={
            "title": "Calendar test — uninvited",
            "starts_at": "2027-05-07T09:00:00+00:00",
            "ends_at": "2027-05-07T10:00:00+00:00",
        },
        headers=headers,
    ).get_json()

    outsider = _authenticate(monkeypatch, "operator", "operator")
    response = client.post(
        f"{EVENTS}/{created['id']}/respond", json={"response": "ACCEPTED"}, headers=outsider
    )
    assert response.status_code == 403
    assert "not invited" in response.get_json()["message"]


@pytest.mark.database
def test_answering_an_invitation_needs_only_the_read_permission(client, monkeypatch):
    """Answering is not editing a calendar. A viewer holds `calendar.view` and
    not `calendar.manage`, and has to be able to say they are coming."""
    headers = _authenticate(monkeypatch)

    from src.models.identity import User

    with session_scope() as session:
        viewer = session.scalars(select(User).where(User.username == "user")).first()
        invitee = str(viewer.id)

    created = client.post(
        EVENTS,
        json={
            "title": "Calendar test — viewer answers",
            "starts_at": "2027-05-08T09:00:00+00:00",
            "ends_at": "2027-05-08T10:00:00+00:00",
            "participants": [{"user_id": invitee}],
        },
        headers=headers,
    ).get_json()

    as_viewer = _authenticate(monkeypatch, "user", "user")
    # They cannot write to the calendar…
    assert client.post(
        EVENTS,
        json={"title": "no", "starts_at": "2027-05-09T09:00:00Z", "ends_at": "2027-05-09T10:00:00Z"},
        headers=as_viewer,
    ).status_code == 403
    # …and can still answer their own invitation.
    assert client.post(
        f"{EVENTS}/{created['id']}/respond", json={"response": "DECLINED"}, headers=as_viewer
    ).status_code == 200


@pytest.mark.database
def test_only_the_organiser_changes_an_event(client, monkeypatch):
    """It sits in other people's weeks, so "anybody who may write to the
    calendar may rewrite yours" is the wrong default."""
    as_manager = _authenticate(monkeypatch, "manager", "manager")
    created = client.post(
        EVENTS,
        json={
            "title": "Calendar test — ownership",
            "starts_at": "2027-05-11T09:00:00+00:00",
            "ends_at": "2027-05-11T10:00:00+00:00",
        },
        headers=as_manager,
    ).get_json()
    assert created["can_edit"] is True

    as_operator = _authenticate(monkeypatch, "operator", "operator")
    seen = client.get(f"{EVENTS}/{created['id']}", headers=as_operator).get_json()
    # Readable, and the server says the control should not be offered (§76).
    assert seen["can_edit"] is False
    assert client.put(
        f"{EVENTS}/{created['id']}", json={"title": "Mine now"}, headers=as_operator
    ).status_code == 403


@pytest.mark.database
def test_an_administrator_can_cancel_a_meeting_whose_organiser_has_left(client, monkeypatch):
    as_manager = _authenticate(monkeypatch, "manager", "manager")
    created = client.post(
        EVENTS,
        json={
            "title": "Calendar test — admin cancels",
            "starts_at": "2027-05-12T09:00:00+00:00",
            "ends_at": "2027-05-12T10:00:00+00:00",
        },
        headers=as_manager,
    ).get_json()

    admin = _authenticate(monkeypatch, "admin", "administrator")
    assert client.delete(f"{EVENTS}/{created['id']}", headers=admin).status_code == 200


@pytest.mark.database
def test_cancelling_an_event_says_so_as_well_as_removing_it(client, monkeypatch):
    """Two different questions: the row stays for the audit trail, and anything
    still reading the event sees that it is not happening."""
    headers = _authenticate(monkeypatch)
    created = client.post(
        EVENTS,
        json={
            "title": "Calendar test — cancelled",
            "starts_at": "2027-05-13T09:00:00+00:00",
            "ends_at": "2027-05-13T10:00:00+00:00",
        },
        headers=headers,
    ).get_json()

    assert client.delete(f"{EVENTS}/{created['id']}", headers=headers).status_code == 200

    from src.models.business import CalendarEvent

    with session_scope() as session:
        row = session.get(CalendarEvent, created["id"])
        assert row.deleted_at is not None
        assert row.status == "CANCELLED"

    assert client.get(f"{EVENTS}/{created['id']}", headers=headers).status_code == 404


@pytest.mark.database
def test_the_window_can_be_narrowed_to_what_involves_me(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    everything = client.get(
        f"{EVENTS}?from=2026-08-01&to=2026-10-01", headers=headers
    ).get_json()
    mine = client.get(
        f"{EVENTS}?from=2026-08-01&to=2026-10-01&mine=1", headers=headers
    ).get_json()

    assert mine["total"] <= everything["total"]
    assert all(item["involves_me"] for item in mine["items"])


@pytest.mark.database
def test_a_category_that_does_not_exist_is_named_rather_than_ignored(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    response = client.get(
        f"{EVENTS}?from=2026-08-01&to=2026-09-01&category=PARTY", headers=headers
    )
    assert response.status_code == 400
    assert "MEETING" in response.get_json()["details"]["allowed"]


@pytest.mark.database
def test_editing_a_series_is_audited_and_says_it_changed_the_series(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    created = client.post(
        EVENTS,
        json={
            "title": "Calendar test — audited",
            "starts_at": "2027-05-14T09:00:00+00:00",
            "ends_at": "2027-05-14T10:00:00+00:00",
            "location": "Room Aurora (4)",
        },
        headers=headers,
    ).get_json()

    client.put(
        f"{EVENTS}/{created['id']}", json={"location": "Room Basalt (8)"}, headers=headers
    )

    from src.models.platform import AuditLog

    with session_scope() as session:
        entry = session.scalars(
            select(AuditLog)
            .where(
                AuditLog.resource_type == "calendar_event",
                AuditLog.resource_id == created["id"],
                AuditLog.action == "calendar.update",
            )
            .order_by(AuditLog.occurred_at.desc())
        ).first()
    assert entry is not None
    assert entry.state_before["location"] == "Room Aurora (4)"
    assert entry.state_after["location"] == "Room Basalt (8)"


@pytest.mark.database
def test_an_occurrence_id_is_accepted_wherever_an_event_id_is(client, monkeypatch):
    """The grid hands back the id it was given, and making every call site
    remember to split on the colon is a bug waiting for the one that forgets."""
    headers = _authenticate(monkeypatch)
    created = client.post(
        EVENTS,
        json={
            "title": "Calendar test — occurrence id",
            "starts_at": "2027-05-17T09:00:00+00:00",
            "ends_at": "2027-05-17T09:30:00+00:00",
            "recurrence": {"freq": "WEEKLY", "interval": 1, "byday": ["MO"]},
            "recurrence_until": "2027-06-30T00:00:00+00:00",
        },
        headers=headers,
    ).get_json()

    answer = client.get(f"{EVENTS}?from=2027-05-01&to=2027-06-01", headers=headers).get_json()
    occurrence = next(
        item for item in answer["items"] if item["title"] == "Calendar test — occurrence id"
    )
    assert ":" in occurrence["id"]

    # `_event` resolves it to the series it belongs to.
    with session_scope() as session:
        row = service._event(session, occurrence["id"])
    assert str(row.id) == created["id"]
