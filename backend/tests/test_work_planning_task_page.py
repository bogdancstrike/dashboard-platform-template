"""Work planning (§18): the timeline, sprints, backlog, templates, recurrence. — the task page, the board's settings."""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from sqlalchemy import select

from tests.work_planning_support import (  # noqa: F401
    PREFIX,
    _as,
    _day,
    _task,
    pytestmark,
)


def test_planning_detail_watchers_epics_and_lanes(client, monkeypatch):
    headers = _as(monkeypatch)
    epic = _task(client, headers, "An epic", kind="EPIC")
    child = _task(client, headers, "Child of the epic", epic_id=epic["id"], story_points=2)
    sub = _task(client, headers, "A subtask", parent_id=child["id"])
    blocker = _task(client, headers, "The blocker")
    client.post(f"{PREFIX}/api/work/dependencies", headers=headers,
                json={"predecessor_id": blocker["id"], "successor_id": child["id"]})

    watched = client.post(f"{PREFIX}/api/tasks/{child['id']}/watchers", headers=headers, json={})
    assert watched.status_code == 200 and watched.get_json()["watchers"] == 1
    plan = client.get(f"{PREFIX}/api/tasks/{child['id']}/planning", headers=headers).get_json()
    assert plan["epic"]["id"] == epic["id"]
    assert [item["id"] for item in plan["subtasks"]] == [sub["id"]]
    assert [item["id"] for item in plan["blocked_by"]] == [blocker["id"]]
    assert plan["watching"] is True
    epic_plan = client.get(f"{PREFIX}/api/tasks/{epic['id']}/planning", headers=headers).get_json()
    assert [item["id"] for item in epic_plan["children"]] == [child["id"]]
    sub_plan = client.get(f"{PREFIX}/api/tasks/{sub['id']}/planning", headers=headers).get_json()
    assert sub_plan["parent"]["id"] == child["id"]
    unwatched = client.delete(f"{PREFIX}/api/tasks/{child['id']}/watchers", headers=headers, json={})
    assert unwatched.get_json()["watching"] is False
    assert client.post(f"{PREFIX}/api/tasks/{child['id']}/watchers", headers=headers,
                       json={"user_id": "00000000-0000-0000-0000-000000000000"}).status_code == 404

    epics = client.get(f"{PREFIX}/api/work/epics", headers=headers).get_json()["items"]
    mine = next(item for item in epics if item["id"] == epic["id"])
    assert mine["children"] == 1 and mine["points"] == 2

    lanes = client.get(f"{PREFIX}/api/work/lanes", headers=headers).get_json()
    before = {item["status"]: item["wip_limit"] for item in lanes["items"]}
    try:
        changed = client.put(f"{PREFIX}/api/work/lanes", headers=headers, json={"limits": {"CANCELLED": 1}})
        assert changed.status_code == 200
        lane = next(item for item in changed.get_json()["items"] if item["status"] == "CANCELLED")
        assert lane["wip_limit"] == 1 and lane["over_limit"] is (lane["count"] > 1)
        assert client.put(f"{PREFIX}/api/work/lanes", headers=headers, json={"LATER": 2}).status_code == 400
        assert client.put(f"{PREFIX}/api/work/lanes", headers=headers, json={"NEW": 0}).status_code == 400
        assert client.put(f"{PREFIX}/api/work/lanes", headers=headers, json={"NEW": "x"}).status_code == 400
        assert client.put(f"{PREFIX}/api/work/lanes", headers=headers, json={}).status_code == 400
    finally:
        client.put(f"{PREFIX}/api/work/lanes", headers=headers, json={"CANCELLED": before.get("CANCELLED")})


def test_a_status_change_restarts_the_cards_age(client, monkeypatch):
    from src.core.db import session_scope
    from src.models.business import Task

    headers = _as(monkeypatch)
    task = _task(client, headers, "Ageing")
    client.put(f"{PREFIX}/api/records/task/{task['id']}", headers=headers, json={"status": "IN_PROGRESS"})
    with session_scope() as session:
        row = session.get(Task, task["id"])
        assert row.status_changed_at is not None
        assert row.status_changed_at > datetime.now(timezone.utc) - timedelta(minutes=5)


def test_templates_make_tasks_and_tasks_make_templates(client, monkeypatch):
    headers = _as(monkeypatch)
    base = f"{PREFIX}/api/work/templates"
    made = client.post(base, headers=headers, json={
        "name": "Test template", "title": "From a template", "kind": "bug", "priority": "high",
        "estimate_hours": 3, "story_points": 2, "due_in_days": 4, "labels": ["urgent"],
        "checklist": [{"text": "First"}, "Second", ""], "cover_color": "#dc2626",
    })
    assert made.status_code == 201, made.get_data(as_text=True)
    template = made.get_json()
    assert [item["text"] for item in template["checklist"]] == ["First", "Second"]

    used = client.post(f"{base}/{template['id']}/use", headers=headers, json={"start_date": _day(0)})
    assert used.status_code == 201, used.get_data(as_text=True)
    task = used.get_json()
    assert task["title"] == "From a template"
    fields = {item["name"]: item["value"] for item in task["fields"]}
    assert fields["kind"] == "BUG" and fields["due_date"].startswith(_day(4))
    assert client.get(f"{base}/{template['id']}", headers=headers).get_json()["usage_count"] == 1

    changed = client.put(f"{base}/{template['id']}", headers=headers, json={"due_in_days": None, "story_points": ""})
    assert changed.status_code == 200 and changed.get_json()["due_in_days"] is None
    for bad in ({"kind": "NOPE"}, {"priority": "NOPE"}, {"estimate_hours": "x"}, {"story_points": 5000},
                {"labels": "a"}, {"due_in_days": -1}, {"due_in_days": "x"}, {"checklist": "x"}, {"name": ""}):
        assert client.put(f"{base}/{template['id']}", headers=headers, json=bad).status_code == 400, bad
    assert client.post(base, headers=headers, json={"name": ""}).status_code == 400

    saved = client.post(f"{PREFIX}/api/tasks/{task['id']}/save-as-template", headers=headers, json={"name": "Copied back"})
    assert saved.status_code == 201 and saved.get_json()["name"] == "Copied back"
    listing = client.get(base, headers=headers, query_string={"q": "Copied"}).get_json()
    assert [item["name"] for item in listing["items"]] == ["Copied back"]
    assert client.delete(f"{base}/{template['id']}", headers=headers).status_code == 200
    assert client.get(f"{base}/{template['id']}", headers=headers).status_code == 404


def test_a_recurring_task_makes_its_next_copy_when_due(client, monkeypatch):
    from src.core.db import session_scope
    from src.models.business import Task
    from src.models.planning import TaskRecurrence

    headers = _as(monkeypatch)
    source = _task(client, headers, "Recurring report", start_date=_day(-3), due_date=_day(-2),
                   checklist=[{"text": "Collect", "done": True}])
    url = f"{PREFIX}/api/tasks/{source['id']}/recurrence"
    assert client.get(url, headers=headers).get_json()["recurrence"] is None
    for bad in ({"frequency": "HOURLY"}, {"interval": 0}, {"interval": "x"}, {"unit": "YEAR"},
                {"weekdays": [9]}, {"frequency": "MONTHLY", "month_day": 40}, {"frequency": "MONTHLY", "month_day": "x"}):
        assert client.put(url, headers=headers, json=bad).status_code == 400, bad
    rule = client.put(url, headers=headers, json={"frequency": "WEEKLY", "weekdays": [0, 3]}).get_json()["recurrence"]
    assert rule["summary"] == "Every week on Mon, Thu"
    for spec, text in (
        ({"frequency": "DAILY", "interval": 2}, "Every 2 days"),
        ({"frequency": "MONTHLY", "month_day": 15}, "Every month on day 15"),
        ({"frequency": "CUSTOM", "interval": 3, "unit": "WEEK", "until": _day(200)}, "Every 3 weeks"),
        ({"frequency": "DAILY"}, "Every day"),
    ):
        got = client.put(url, headers=headers, json=spec).get_json()["recurrence"]
        assert got["summary"].startswith(text), got

    # Pretend the rule came due yesterday, then run the scheduler.
    with session_scope() as session:
        row = session.scalars(select(TaskRecurrence).where(TaskRecurrence.task_id == source["id"])).one()
        row.next_run_at = datetime.now(timezone.utc) - timedelta(days=1)
    ran = client.post(f"{PREFIX}/api/work/scheduler/run", headers=headers)
    assert ran.status_code == 200, ran.get_data(as_text=True)
    created = ran.get_json()["results"]["work.recurring-tasks"]["created"]
    assert len(created) >= 1
    with session_scope() as session:
        copy = session.scalars(select(Task).where(Task.reference == created[0])).unique().one()
        assert copy.title == "Recurring report" and copy.status == "NEW"
        assert copy.checklist == [{"text": "Collect", "done": False}]
        assert copy.recurrence_id is not None
    detail = client.get(url, headers=headers).get_json()["recurrence"]
    assert detail["occurrences"] >= 1
    assert datetime.fromisoformat(detail["next_run_at"]) > datetime.now(timezone.utc)

    assert client.delete(url, headers=headers).get_json()["recurrence"] is None


def test_next_occurrence_arithmetic():
    from types import SimpleNamespace

    from src.services.work.task_templates import next_after

    monday = datetime(2026, 11, 9, 6, tzinfo=timezone.utc)

    def rule(**kw):
        base = dict(frequency="DAILY", interval=1, unit="DAY", weekdays=None, month_day=None, until=None)
        return SimpleNamespace(**(base | kw))

    assert next_after(rule(), monday).date() == date(2026, 11, 10)
    assert next_after(rule(frequency="WEEKLY", weekdays=[2]), monday).date() == date(2026, 11, 11)
    assert next_after(rule(frequency="WEEKLY", weekdays=[0], interval=2), monday).date() == date(2026, 11, 23)
    assert next_after(rule(frequency="MONTHLY", month_day=31), monday).date() == date(2026, 11, 30)
    assert next_after(rule(frequency="MONTHLY", month_day=5), monday).date() == date(2026, 12, 5)
    assert next_after(rule(frequency="MONTHLY", month_day=5, interval=2), datetime(2026, 12, 5, tzinfo=timezone.utc)).date() == date(2027, 2, 5)
    assert next_after(rule(frequency="CUSTOM", interval=2, unit="WEEK"), monday).date() == date(2026, 11, 23)
    assert next_after(rule(until=date(2026, 11, 9)), monday) is None


def test_critical_path_arithmetic():
    from src.services.work.timeline import critical_path

    d = date(2026, 1, 1)
    spans = {
        "a": (d, d + timedelta(days=2)),
        "b": (d + timedelta(days=3), d + timedelta(days=9)),
        "c": (d + timedelta(days=3), d + timedelta(days=4)),
        "e": (d + timedelta(days=10), d + timedelta(days=11)),
        "lone": (d, d),
    }
    links = [("a", "b", 0), ("a", "c", 0), ("b", "e", 0), ("c", "e", 0)]
    assert critical_path(spans, links) == {"a", "b", "e"}
    assert critical_path(spans, []) == set()
    assert critical_path(spans, [("a", "b", 0), ("b", "a", 0)]) == set()


def test_the_seed_plans_work_and_runs_twice_without_duplicating(engine):
    """Run inside one transaction that is rolled back, on a plan wiped first."""
    from sqlalchemy import delete, func
    from sqlalchemy.orm import Session

    from src.models.planning import Sprint, SprintSnapshot, TaskTemplate
    from src.seed import planning

    with Session(engine) as session:
        session.execute(delete(SprintSnapshot))
        session.execute(delete(Sprint))
        made = planning.populate(session)
        assert made["sprints"] >= 6 and made["epics"] >= 2 and made["dependencies"] > 0
        assert made["templates"] == len(planning.TEMPLATES) and made["recurrences"] == len(planning.RECURRING)
        states = dict(session.execute(select(Sprint.state, func.count()).group_by(Sprint.state)).all())
        assert states["ACTIVE"] >= 1 and states["COMPLETED"] >= 4 and states["PLANNED"] >= 1
        assert session.scalar(select(func.count()).select_from(SprintSnapshot)) > 0
        templates = session.scalar(select(func.count()).select_from(TaskTemplate))
        again = planning.populate(session)
        assert "sprints" not in again
        assert session.scalar(select(func.count()).select_from(TaskTemplate)) == templates
        session.rollback()
