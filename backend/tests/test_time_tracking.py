"""Time tracking: one timer, honest totals, weeks that lock when submitted.

The scenarios are the ones somebody would try in the first hour: start a timer
on a task and start another on a ticket (the first stops); type a duration and
a start-and-end; type into the week grid; submit the week and find it locked;
have it rejected and find it open again; read the reports and download them.
"""

from __future__ import annotations

import csv
import io
from datetime import date, timedelta

import pytest
from sqlalchemy import select

from src.config import Config
from src.core.db import session_scope
from tests.conftest import persona_claims

pytestmark = pytest.mark.database

PREFIX = Config.API_PREFIX
TIME = f"{PREFIX}/api/time"
#: A week nobody's seeded time is in, so a submitted sheet never collides.
WEEK = date(2021, 3, 1)


@pytest.fixture()
def as_(monkeypatch):
    roles = {"admin": "administrator", "manager": "manager", "operator": "operator",
             "analyst": "analyst", "user": "user"}

    def claims(token):
        name = token.split("-", 1)[1]
        return persona_claims(name, roles[name], sid=f"time-{name}")

    monkeypatch.setattr("src.core.auth.verify_token", claims)
    return lambda name: {"Authorization": f"Bearer time-{name}"}


@pytest.fixture(autouse=True)
def _no_running_timer():
    """A timer left running by a person using the demo must not decide a test."""
    from src.models.timekeeping import TimeEntry

    with session_scope() as session:
        for entry in session.scalars(select(TimeEntry).where(TimeEntry.ended_at.is_(None),
                                                             TimeEntry.source == "TIMER")).all():
            if entry.user and entry.user.username in ("operator", "analyst"):
                session.delete(entry)
    yield


def _ids():
    from src.models.business import Project, Task, Ticket

    with session_scope() as session:
        task = session.scalars(select(Task).where(Task.deleted_at.is_(None), Task.project_id.is_not(None))).first()
        ticket = session.scalars(select(Ticket).where(Ticket.deleted_at.is_(None))).first()
        project = session.scalars(select(Project).where(Project.deleted_at.is_(None))).first()
        return str(task.id), str(ticket.id), str(project.id)


def test_one_timer_at_a_time_and_stopping_logs_the_minutes(client, as_):
    task, ticket, _ = _ids()
    headers = as_("operator")
    assert client.get(f"{TIME}/timer", headers=headers).json["running"] is None

    started = client.post(f"{TIME}/timer", json={"subject_type": "task", "subject_id": task}, headers=headers)
    assert started.status_code == 200, started.json
    assert started.json["running"]["subject_type"] == "task"
    assert started.json["running"]["link"] == f"/tasks/{task}"

    # Pressing start on the same thing again is the same timer.
    same = client.post(f"{TIME}/timer", json={"subject_type": "task", "subject_id": task}, headers=headers)
    assert same.json["running"]["id"] == started.json["running"]["id"]

    switched = client.post(f"{TIME}/timer", json={"subject_type": "ticket", "subject_id": ticket},
                           headers=headers)
    assert switched.json["stopped"]["id"] == started.json["running"]["id"]
    assert switched.json["stopped"]["minutes"] >= 1
    current = client.get(f"{TIME}/timer", headers=headers).json
    assert current["running"]["subject_type"] == "ticket"
    assert current["running"]["elapsed_seconds"] >= 0

    # A running entry cannot be edited.
    running_id = current["running"]["id"]
    assert client.put(f"{TIME}/entries/{running_id}", json={"minutes": 5}, headers=headers).status_code == 409

    stopped = client.post(f"{TIME}/timer/stop", json={"note": "Call with the customer", "billable": False},
                          headers=headers)
    assert stopped.json["stopped"]["note"] == "Call with the customer"
    assert stopped.json["stopped"]["billable"] is False
    assert client.post(f"{TIME}/timer/stop", json={}, headers=headers).status_code == 404

    on = client.get(f"{TIME}/on", query_string={"subject_type": "ticket", "subject_id": ticket},
                    headers=headers).json
    assert on["my_minutes"] >= 1 and on["entries"]


def test_a_timer_needs_something_real_to_run_against(client, as_):
    headers = as_("operator")
    assert client.post(f"{TIME}/timer", json={"subject_type": "order", "subject_id": "x"},
                       headers=headers).status_code == 400
    assert client.post(f"{TIME}/timer", json={"subject_type": "task",
                                              "subject_id": "11111111-1111-1111-1111-111111111111"},
                       headers=headers).status_code == 400


def test_manual_entries_by_duration_or_by_start_and_end(client, as_):
    task, _, project = _ids()
    headers = as_("operator")
    by_duration = client.post(f"{TIME}/entries", json={
        "subject_type": "task", "subject_id": task, "work_date": WEEK.isoformat(), "minutes": 90,
        "note": "Design review", "billable": True}, headers=headers)
    assert by_duration.status_code == 201, by_duration.json
    assert by_duration.json["minutes"] == 90 and by_duration.json["source"] == "MANUAL"

    by_span = client.post(f"{TIME}/entries", json={
        "subject_type": "project", "subject_id": project,
        "started_at": f"{WEEK.isoformat()}T09:00:00+00:00", "ended_at": f"{WEEK.isoformat()}T10:15:00+00:00"},
        headers=headers)
    assert by_span.json["minutes"] == 75

    for bad in ({"subject_type": "task", "subject_id": task},
                {"subject_type": "task", "subject_id": task, "minutes": 2000},
                {"subject_type": "task", "subject_id": task, "minutes": "lots"},
                {"subject_type": "task", "subject_id": task, "work_date": "yesterday", "minutes": 5},
                {"subject_type": "task", "subject_id": task, "started_at": "2021-03-01T10:00:00+00:00",
                 "ended_at": "2021-03-01T09:00:00+00:00"},
                {"subject_type": "task", "subject_id": task, "started_at": "nope", "ended_at": "later"}):
        assert client.post(f"{TIME}/entries", json=bad, headers=headers).status_code == 400, bad

    edited = client.put(f"{TIME}/entries/{by_duration.json['id']}",
                        json={"minutes": 60, "note": "Shorter", "billable": False,
                              "subject_type": "project", "subject_id": project}, headers=headers)
    assert edited.json["minutes"] == 60 and edited.json["subject_type"] == "project"
    assert client.put(f"{TIME}/entries/{by_duration.json['id']}", json={"minutes": 0},
                      headers=headers).status_code == 400

    # Somebody else's entry does not exist, as far as anybody else is concerned.
    assert client.put(f"{TIME}/entries/{by_duration.json['id']}", json={"minutes": 5},
                      headers=as_("analyst")).status_code == 404

    listed = client.get(f"{TIME}/entries", query_string={"from": WEEK.isoformat(),
                                                          "to": (WEEK + timedelta(days=6)).isoformat(),
                                                          "billable": "false", "subject_type": "project"},
                        headers=headers).json
    assert listed["total"] == 1 and listed["total_minutes"] == 60

    assert client.delete(f"{TIME}/entries/{by_span.json['id']}", headers=headers).json["removed"] is True


def test_the_week_grid_adds_up_and_a_cell_cannot_go_below_its_timed_entries(client, as_):
    task, ticket, _ = _ids()
    headers = as_("operator")
    monday, tuesday = WEEK, WEEK + timedelta(days=1)
    client.post(f"{TIME}/entries", json={"subject_type": "task", "subject_id": task,
                                         "work_date": monday.isoformat(), "minutes": 30}, headers=headers)

    grid = client.put(f"{TIME}/cell", json={"subject_type": "task", "subject_id": task,
                                            "date": monday.isoformat(), "minutes": 120}, headers=headers)
    assert grid.status_code == 200, grid.json
    row = next(item for item in grid.json["rows"] if item["subject_id"] == task)
    assert row["cells"][monday.isoformat()] == 120
    assert row["fixed"][monday.isoformat()] == 30

    lowered = client.put(f"{TIME}/cell", json={"subject_type": "task", "subject_id": task,
                                               "date": monday.isoformat(), "minutes": 45}, headers=headers)
    assert next(item for item in lowered.json["rows"] if item["subject_id"] == task)["cells"][monday.isoformat()] == 45
    refused = client.put(f"{TIME}/cell", json={"subject_type": "task", "subject_id": task,
                                               "date": monday.isoformat(), "minutes": 10}, headers=headers)
    assert refused.status_code == 409 and refused.json["details"]["fixed_minutes"] == 30

    client.put(f"{TIME}/cell", json={"subject_type": "ticket", "subject_id": ticket,
                                     "date": tuesday.isoformat(), "minutes": 60}, headers=headers)
    cleared = client.put(f"{TIME}/cell", json={"subject_type": "task", "subject_id": task,
                                               "date": monday.isoformat(), "minutes": 30}, headers=headers)
    week = cleared.json
    assert week["day_totals"][monday.isoformat()] == 30
    assert week["day_totals"][tuesday.isoformat()] == 60
    assert week["total_minutes"] == 90
    assert week["can_submit"] is True and week["timesheet"]["status"] == "DRAFT"
    assert week["previous_week"] == (WEEK - timedelta(days=7)).isoformat()


def test_submit_locks_the_week_reject_unlocks_it_and_approve_closes_it(client, as_):
    task, _, _ = _ids()
    headers = as_("operator")
    assert client.post(f"{TIME}/submit", json={"week": WEEK.isoformat()},
                       headers=headers).status_code == 400  # nothing in it yet
    entry = client.post(f"{TIME}/entries", json={"subject_type": "task", "subject_id": task,
                                                  "work_date": WEEK.isoformat(), "minutes": 240},
                        headers=headers).json

    submitted = client.post(f"{TIME}/submit", json={"week": WEEK.isoformat(), "note": "Busy week"},
                            headers=headers)
    assert submitted.status_code == 200, submitted.json
    assert submitted.json["timesheet"]["status"] == "SUBMITTED"
    assert submitted.json["locked"] is True and submitted.json["can_edit"] is False
    approval_id = submitted.json["timesheet"]["approval_id"]

    # Locked: nothing in the week moves.
    assert client.put(f"{TIME}/entries/{entry['id']}", json={"minutes": 10}, headers=headers).status_code == 409
    assert client.post(f"{TIME}/entries", json={"subject_type": "task", "subject_id": task,
                                                 "work_date": WEEK.isoformat(), "minutes": 5},
                       headers=headers).status_code == 409
    assert client.post(f"{TIME}/submit", json={"week": WEEK.isoformat()}, headers=headers).status_code == 409

    # The manager sees it on the team view and in the approvals inbox.
    team = client.get(f"{TIME}/team", query_string={"week": WEEK.isoformat()}, headers=as_("manager")).json
    assert any(row["status"] == "SUBMITTED" and row["total_minutes"] == 240 for row in team["items"])
    detail = client.get(f"{PREFIX}/api/approvals/{approval_id}", headers=as_("manager")).json
    assert detail["kind"] == "timesheet"
    assert sum(day["minutes"] for day in detail["details"]["days"]) == 240
    peek = client.get(f"{TIME}/week", query_string={"week": WEEK.isoformat(),
                                                    "user_id": submitted.json["user"]["id"]},
                      headers=as_("manager")).json
    assert peek["total_minutes"] == 240 and peek["can_edit"] is False
    assert client.get(f"{TIME}/week", query_string={"user_id": submitted.json["user"]["id"]},
                      headers=as_("analyst")).status_code == 403
    assert client.get(f"{TIME}/team", headers=as_("analyst")).status_code == 403

    rejected = client.post(f"{PREFIX}/api/approvals/{approval_id}/decision",
                           json={"decision": "reject", "comment": "Split the review"}, headers=as_("manager"))
    assert rejected.json["status"] == "REJECTED"
    reopened = client.get(f"{TIME}/week", query_string={"week": WEEK.isoformat()}, headers=headers).json
    assert reopened["timesheet"]["status"] == "REJECTED" and reopened["can_edit"] is True
    assert reopened["timesheet"]["decision_comment"] == "Split the review"

    resubmitted = client.post(f"{TIME}/submit", json={"week": WEEK.isoformat()}, headers=headers).json
    second = resubmitted["timesheet"]["approval_id"]
    assert second != approval_id
    client.post(f"{PREFIX}/api/approvals/{second}/decision", json={"decision": "approve"}, headers=as_("manager"))
    final = client.get(f"{TIME}/week", query_string={"week": WEEK.isoformat()}, headers=headers).json
    assert final["timesheet"]["status"] == "APPROVED" and final["locked"] is True


def test_withdrawing_a_submitted_week_opens_it_again(client, as_):
    task, _, _ = _ids()
    headers = as_("analyst")
    week = WEEK + timedelta(days=14)
    client.post(f"{TIME}/entries", json={"subject_type": "task", "subject_id": task,
                                         "work_date": week.isoformat(), "minutes": 60}, headers=headers)
    submitted = client.post(f"{TIME}/submit", json={"week": week.isoformat()}, headers=headers).json
    client.post(f"{PREFIX}/api/approvals/{submitted['timesheet']['approval_id']}/withdraw", headers=headers)
    after = client.get(f"{TIME}/week", query_string={"week": week.isoformat()}, headers=headers).json
    assert after["timesheet"]["status"] == "DRAFT" and after["can_edit"] is True


def test_reports_group_five_ways_and_only_approvers_see_everyone(client, as_):
    task, ticket, _ = _ids()
    headers = as_("operator")
    client.post(f"{TIME}/entries", json={"subject_type": "task", "subject_id": task,
                                         "work_date": WEEK.isoformat(), "minutes": 50}, headers=headers)
    client.post(f"{TIME}/entries", json={"subject_type": "ticket", "subject_id": ticket,
                                         "work_date": WEEK.isoformat(), "minutes": 70, "billable": False},
                headers=headers)
    span = {"from": WEEK.isoformat(), "to": (WEEK + timedelta(days=6)).isoformat()}
    for group in ("person", "project", "customer", "subject", "day"):
        result = client.get(f"{TIME}/report", query_string={**span, "group_by": group}, headers=headers)
        assert result.status_code == 200, (group, result.json)
        assert result.json["total_minutes"] >= 120
    mine = client.get(f"{TIME}/report", query_string={**span, "billable": "true"}, headers=headers).json
    assert mine["can_see_everyone"] is False and mine["billable_minutes"] == mine["total_minutes"]
    everyone = client.get(f"{TIME}/report", query_string=span, headers=as_("manager")).json
    assert everyone["can_see_everyone"] is True
    assert client.get(f"{TIME}/report", query_string={"group_by": "mood"}, headers=headers).status_code == 400
    assert client.get(f"{TIME}/report", query_string={"from": "2021-03-10", "to": "2021-03-01"},
                      headers=headers).status_code == 400

    exported = client.get(f"{TIME}/export", query_string={**span, "format": "csv"}, headers=headers)
    assert exported.status_code == 200
    assert "attachment" in exported.headers["Content-Disposition"]
    lines = list(csv.DictReader(io.StringIO(exported.get_data(as_text=True))))
    assert {line["Minutes"] for line in lines} >= {"50", "70"}
    assert {line["Billable"] for line in lines} == {"yes", "no"}
    xlsx = client.get(f"{TIME}/export", query_string={**span, "format": "xlsx"}, headers=headers)
    assert xlsx.status_code == 200 and xlsx.data[:2] == b"PK"
    assert client.get(f"{TIME}/export", query_string={"format": "pdf"}, headers=headers).status_code == 400


def test_the_subject_picker_offers_recent_work_and_searches(client, as_):
    task, _, _ = _ids()
    headers = as_("operator")
    client.post(f"{TIME}/entries", json={"subject_type": "task", "subject_id": task,
                                         "work_date": WEEK.isoformat(), "minutes": 15}, headers=headers)
    recent = client.get(f"{TIME}/subjects", headers=headers).json
    assert any(item["subject_id"] == task and item["recent"] for item in recent["items"])
    found = client.get(f"{TIME}/subjects", query_string={"q": "a"}, headers=headers).json
    assert {item["subject_type"] for item in found["items"]} <= {"task", "ticket", "project"}
    assert found["items"]


def test_week_and_entries_validate_their_arguments(client, as_):
    headers = as_("operator")
    assert client.get(f"{TIME}/week", query_string={"week": "soon"}, headers=headers).status_code == 400
    assert client.get(f"{TIME}/entries", query_string={"user_id": "all"}, headers=headers).status_code == 403
    assert client.get(f"{TIME}/entries", query_string={"user_id": "all", "billable": "true",
                                                       "order": "asc"},
                      headers=as_("manager")).status_code == 200
    assert client.delete(f"{TIME}/entries/11111111-1111-1111-1111-111111111111",
                         headers=headers).status_code == 404


def test_week_start_is_a_monday():
    from src.services.timekeeping import week_start

    assert week_start(date(2026, 11, 15)) == date(2026, 11, 9)
    assert week_start(date(2026, 11, 9)) == date(2026, 11, 9)
