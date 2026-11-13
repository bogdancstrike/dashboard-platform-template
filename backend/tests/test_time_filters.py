"""Time tracking's lists and reports, narrowed every way the page narrows them.

`test_time_tracking` covers timers, the week grid and submission. These pin
the entries list and the report under each filter (subject, billable,
project, customer, person), the export's size refusal, and the small parsers.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime

import pytest

from src.core.errors import ValidationError
from src.services import timekeeping as service
from tests.personas import PREFIX, as_each

pytestmark = pytest.mark.database


def test_the_entries_list_and_report_take_every_filter(client, monkeypatch):
    headers = as_each(monkeypatch)
    admin = headers("admin")
    any_id = str(uuid.uuid4())
    for query in ({"subject_type": "task", "subject_id": any_id, "billable": "true"},
                  {"billable": "false", "from": "2027-01-01", "to": "2027-01-31"}):
        listed = client.get(f"{PREFIX}/api/time/entries", query_string=query, headers=admin)
        assert listed.status_code == 200, (query, listed.get_json())
    for query in ({"billable": "true", "project_id": any_id, "customer_id": any_id, "user_id": any_id},
                  {"group": "day", "from": "2027-01-01", "to": "2027-01-31"}):
        reported = client.get(f"{PREFIX}/api/time/report", query_string=query, headers=admin)
        assert reported.status_code == 200, (query, reported.get_json())
    backwards = client.get(f"{PREFIX}/api/time/report", query_string={"from": "2027-02-01", "to": "2027-01-01"},
                           headers=admin)
    assert backwards.status_code == 400
    # Somebody who may only track their own time reads only their own report.
    mine = client.get(f"{PREFIX}/api/time/report", query_string={"user_id": any_id}, headers=headers("user"))
    assert mine.status_code in (200, 403)


def test_an_export_bigger_than_a_file_is_refused(client, monkeypatch):
    from src.core import export as writer

    admin = as_each(monkeypatch)("admin")
    monkeypatch.setattr(writer, "limit_for", lambda fmt: -1)
    response = client.get(f"{PREFIX}/api/time/export", query_string={"format": "csv"}, headers=admin)
    assert response.status_code == 400 and "narrow the range" in response.get_json()["message"]


def test_the_parsers_read_dates_and_moments():
    assert service._day(datetime(2027, 1, 2, 9)) == date(2027, 1, 2)
    with pytest.raises(ValidationError):
        service._day("not a day")
    with pytest.raises(ValidationError):
        service._moment(object(), field="started_at")
    assert service._link(type("E", (), {"subject_id": None})()) is None
