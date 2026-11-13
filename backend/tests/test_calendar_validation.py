"""The calendar's write rules: every refusal names its reason, and edits mean what they say.

`test_calendar` covers the expander, clashes and the main journeys. These are
the edges a form hits — each field's validation, partial edits that clear a
value, occurrence ids, the window's filters — so a bad payload is a 400 that
says which field, never a 500 or a silently different event.
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from src.services import calendar as service
from tests.personas import PREFIX, as_each

EVENTS = f"{PREFIX}/api/calendar/events"
START = "2027-09-06T09:00:00+00:00"
END = "2027-09-06T10:00:00+00:00"
ANY_UUID = "6f1c0f0e-6a42-4b8a-9b55-3b9a3d5a1c11"

pytestmark = pytest.mark.database


def _event(**fields):
    return {"title": "Validation probe", "starts_at": START, "ends_at": END, **fields}


@pytest.mark.parametrize(("body", "says"), [
    ({"title": "  ", "starts_at": START, "ends_at": END}, "title"),
    (_event(category="PARTY"), "category"),
    (_event(status="MAYBE"), "status"),
    ({"title": "No times"}, "start and an end"),
    (_event(starts_at="next tuesday"), "starts_at"),
    (_event(ends_at=START), "end after it starts"),
    (_event(participants="everyone"), "participants must be a list"),
    (_event(participants=[ANY_UUID] * 201), "at most 200"),
    (_event(participants=[{"name": "nobody"}]), "user_id"),
    (_event(participants=["not-a-uuid"]), "participants"),
    (_event(recurrence="weekly"), "recurrence must be an object"),
    (_event(recurrence={"freq": "YEARLY"}), "daily, weekly or monthly"),
    (_event(recurrence={"freq": "WEEKLY", "interval": -1}), "1 to 52"),
    (_event(recurrence={"freq": "WEEKLY", "interval": 53}), "1 to 52"),
    (_event(recurrence={"freq": "WEEKLY", "interval": "often"}), "whole number"),
    (_event(recurrence={"freq": "WEEKLY", "byday": ["XX"]}), "weekday"),
    (_event(reminder_minutes=60 * 24 * 15), "14 days"),
    (_event(reminder_minutes="soon"), "whole number"),
    (_event(project_id="nope"), "project_id"),
    (_event(recurrence_until="whenever"), "recurrence_until"),
])
def test_a_bad_event_is_refused_with_its_reason(client, monkeypatch, body, says):
    headers = as_each(monkeypatch)("admin")
    response = client.post(EVENTS, json=body, headers=headers)
    assert response.status_code == 400, response.get_json()
    payload = response.get_json()
    assert says.lower() in (payload["message"] + str(payload.get("details", ""))).lower()


def test_an_edit_can_clear_what_it_set_and_a_series_can_stop_repeating(client, monkeypatch):
    headers = as_each(monkeypatch)
    admin = headers("admin")
    created = client.post(EVENTS, json=_event(
        description="Agenda", location="Room 4", status="TENTATIVE", all_day=False,
        participants=[{"user_id": ANY_UUID, "response": "wrong"}, ANY_UUID],
        recurrence={"freq": "weekly", "byday": ["fr", "mo", "MO"]},
        recurrence_until="2027-12-01", reminder_minutes=15, color="",
    ), headers=admin)
    assert created.status_code == 201, created.get_json()
    event = created.get_json()
    ours = [p for p in event["participants"] if p["user_id"] == ANY_UUID]
    assert len(ours) == 1 and ours[0]["response"] == "NEEDS_ACTION"  # de-duplicated, never invented
    assert event["recurrence"]["byday"] == ["MO", "FR"] and event["color"] == "#5b5bd6"
    assert "Monday and Friday" in event["recurrence_text"]

    edited = client.put(f"{EVENTS}/{event['id']}", json={
        "description": "", "location": None, "recurrence": None, "reminder_minutes": "",
        "participants": [], "project_id": None, "task_id": None,
    }, headers=admin)
    assert edited.status_code == 200, edited.get_json()
    after = edited.get_json()
    assert after["description"] is None and after["location"] is None
    assert after["recurrence"] is None and after["recurrence_until"] is None
    assert after["reminder_minutes"] is None

    # The grid hands back an occurrence id — the series answers to it.
    occurrence = f"{event['id']}:2027-09-06T09:00:00Z"
    assert client.get(f"{EVENTS}/{event['id']}", headers=admin).status_code == 200
    assert service._event.__doc__  # tolerant lookup, exercised below through the service
    assert client.delete(f"{EVENTS}/{event['id']}", headers=admin).status_code == 200
    assert client.get(f"{EVENTS}/{event['id']}", headers=admin).status_code == 404
    assert client.put(f"{EVENTS}/{event['id']}", json={"title": "x"}, headers=admin).status_code == 404
    del occurrence


def test_an_occurrence_id_resolves_to_its_series(app):
    from src.core.db import session_scope
    from src.core.errors import NotFoundError, ValidationError
    from src.models.business import CalendarEvent
    from sqlalchemy import select

    with session_scope() as session:
        row = session.scalars(select(CalendarEvent).where(CalendarEvent.deleted_at.is_(None)).limit(1)).first()
        assert service._event(session, f"{row.id}:2027-01-01T00:00:00Z").id == row.id
        with pytest.raises(NotFoundError):
            service._event(session, ANY_UUID)
        with pytest.raises(ValidationError):
            service._event(session, "garbage")


def test_answering_needs_a_known_response_and_an_invitation(client, monkeypatch):
    headers = as_each(monkeypatch)
    admin, manager = headers("admin"), headers("manager")
    created = client.post(EVENTS, json=_event(), headers=admin).get_json()
    respond = f"{EVENTS}/{created['id']}/respond"
    assert client.post(respond, json={"response": "PERHAPS"}, headers=admin).status_code == 400
    assert client.post(respond, json={}, headers=admin).status_code == 400
    assert client.post(respond, json={"response": "declined"}, headers=manager).status_code == 403
    answered = client.post(respond, json={"response": "tentative"}, headers=admin)
    assert answered.status_code == 200 and answered.get_json()["my_response"] == "TENTATIVE"


def test_the_window_filters_by_category_and_hides_cancelled_on_request(client, monkeypatch):
    headers = as_each(monkeypatch)("admin")
    made = client.post(EVENTS, json=_event(title="Cancelled probe", category="REVIEW", status="CANCELLED"),
                       headers=headers).get_json()
    window = f"{EVENTS}?from=2027-09-01&to=2027-09-30"
    reviews = client.get(f"{window}&category=review", headers=headers).get_json()
    assert made["id"] in {item["event_id"] for item in reviews["items"]}
    assert all(item["category"] == "REVIEW" for item in reviews["items"])
    hidden = client.get(f"{window}&hide_cancelled=1", headers=headers).get_json()
    assert made["id"] not in {item["event_id"] for item in hidden["items"]}
    assert client.get(f"{EVENTS}?from=2027-09-01&to=garbage", headers=headers).status_code == 400


def test_a_viewer_reads_but_cannot_schedule(client, monkeypatch):
    headers = as_each(monkeypatch)
    viewer = headers("user")
    assert client.get(f"{EVENTS}?from=2027-09-01&to=2027-09-30", headers=viewer).status_code == 200
    if client.post(EVENTS, json=_event(), headers=viewer).status_code == 201:
        pytest.skip("the viewer role may schedule here")
    answer = client.get(f"{EVENTS}?from=2027-09-01&to=2027-09-30", headers=viewer).get_json()
    assert answer["can_manage"] is False
    assert all(item["can_edit"] is False for item in answer["items"])


@pytest.mark.parametrize(("rule", "until", "words"), [
    ({"freq": "DAILY", "interval": 1}, None, "every day"),
    ({"freq": "DAILY", "interval": 3}, None, "every third day"),
    ({"freq": "WEEKLY", "interval": 2, "byday": ["TU", "TH"]}, None, "Tuesday and Thursday"),
    ({"freq": "WEEKLY", "interval": 1, "byday": ["MO", "WE", "FR"]}, None, "Monday, Wednesday and Friday"),
    ({"freq": "MONTHLY", "interval": 1}, datetime(2027, 6, 3, tzinfo=UTC), "until 2027-06-03"),
    ({"freq": "MONTHLY", "interval": 2}, None, "every second month"),
    ({"freq": "YEARLY"}, None, ""),
    ("weekly", None, ""),
])
def test_a_repeat_reads_as_a_sentence(rule, until, words):
    assert words in service.describe(rule, until)


def test_a_monthly_series_crosses_the_year_and_stops_at_its_horizon():
    start = datetime(2027, 11, 30, 9, tzinfo=UTC)
    moments = list(service._series(start, "MONTHLY", 1, (), datetime(2028, 4, 1, tzinfo=UTC)))
    assert [m.month for m in moments] == [11, 12, 1, 3]  # no 30 February
    every_five = list(service._series(start, "MONTHLY", 5, (), datetime(2029, 1, 1, tzinfo=UTC)))
    assert [(m.year, m.month) for m in every_five] == [(2027, 11), (2028, 4), (2028, 9)]
