"""The timeline's bars and groups at the edges.

Where a bar runs when only one end was planned (or neither), how the view
groups by epic and by person (including "No epic" and "Unassigned" last), the
done-work toggle, and a reschedule that now finishes after a successor starts.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from types import SimpleNamespace

import pytest

from src.core.errors import ValidationError
from src.services import timeline as service
from tests.personas import PREFIX, sign_in


def _task(**fields):
    base = dict(start_date=None, due_date=None, created_at=None, estimate_hours=None)
    return SimpleNamespace(**{**base, **fields})


def test_a_bar_runs_where_its_planned_ends_say_or_is_marked_unscheduled():
    day = date(2027, 5, 10)
    assert service.span_of(_task(start_date=day, due_date=day + timedelta(days=3))) == (
        day, day + timedelta(days=3), True)
    # Only a due date: as long as the estimate, a working day per eight hours.
    assert service.span_of(_task(due_date=day, estimate_hours=24)) == (day - timedelta(days=2), day, False)
    assert service.span_of(_task(due_date=day)) == (day, day, False)
    assert service.span_of(_task(start_date=day)) == (day, day, False)
    created = datetime(2027, 1, 2, 23, tzinfo=UTC)
    assert service.span_of(_task(created_at=created)) == (date(2027, 1, 2), date(2027, 1, 2), False)
    # Due before it starts: drawn as one day rather than a negative bar.
    assert service.span_of(_task(start_date=day, due_date=day - timedelta(days=4)))[:2] == (day, day)


def test_dates_come_in_three_spellings():
    assert service.as_day("") is None
    assert service.as_day("2027-05-10T09:00:00Z") == date(2027, 5, 10)
    assert service.as_day(datetime(2027, 5, 10, 1)) == date(2027, 5, 10)
    with pytest.raises(ValidationError):
        service.as_day("someday")
    assert service._many("a,,b") == ["a", "b"] and service._many(["x", ""]) == ["x"] and service._many(None) == []
    assert service._name(None) == ""
    assert service._name(SimpleNamespace(full_name="", first_name="Ada", last_name="L")) == "Ada L"


@pytest.mark.database
def test_the_view_groups_by_epic_and_person_and_can_show_done_work(client, monkeypatch):
    headers = sign_in(monkeypatch, "admin")
    today = date.today()
    window = {"from": (today - timedelta(days=30)).isoformat(), "to": (today + timedelta(days=60)).isoformat()}
    for group, last in (("epic", "No epic"), ("assignee", "Unassigned")):
        view = client.get(f"{PREFIX}/api/work/timeline", query_string={**window, "group": group,
                                                                       "include_done": "1"}, headers=headers)
        assert view.status_code == 200, view.get_json()
        groups = view.get_json()["groups"]
        labels = [item["label"] for item in groups]
        if last in labels:
            assert labels[-1] == last  # the bucket of nobody's comes last
        assert all(item["count"] == len(item["items"]) and item["start"] <= item["end"] for item in groups)


@pytest.mark.database
def test_moving_a_bar_past_its_successor_reports_the_clash(client, monkeypatch):
    headers = sign_in(monkeypatch, "admin")
    today = date.today()

    def task(title, start, due):
        made = client.post(f"{PREFIX}/api/records/task", headers=headers, json={
            "title": title, "start_date": start.isoformat(), "due_date": due.isoformat()})
        assert made.status_code == 201, made.get_json()
        return made.get_json()["id"]

    first = task("Clash probe first", today, today + timedelta(days=2))
    then = task("Clash probe then", today + timedelta(days=3), today + timedelta(days=5))
    assert client.post(f"{PREFIX}/api/work/dependencies", headers=headers,
                       json={"predecessor_id": first, "successor_id": then}).status_code in (200, 201)

    moved = client.post(f"{PREFIX}/api/tasks/{first}/schedule", headers=headers,
                        json={"due_date": (today + timedelta(days=8)).isoformat()})
    assert moved.status_code == 200, moved.get_json()
    violations = moved.get_json().get("violations") or []
    assert any(v.get("role", v.get("side")) in ("successor", None) for v in violations) and violations

    bad_lag = client.post(f"{PREFIX}/api/work/dependencies", headers=headers,
                          json={"predecessor_id": then, "successor_id": first, "lag_days": 400})
    assert bad_lag.status_code in (400, 409)
