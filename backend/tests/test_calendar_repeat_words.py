"""The calendar (§19). — The repeat, in words."""

from __future__ import annotations

from datetime import datetime

import pytest
from sqlalchemy import select

from src.core.db import session_scope
from src.services.work import calendar as service
from tests.calendar_support import (  # noqa: F401
    EVENTS,
    UTC,
    _authenticate,
    _occurrence,
)


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
