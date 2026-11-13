"""Work planning (§18): the timeline, sprints, backlog, templates, recurrence. — timeline."""

from __future__ import annotations

from tests.work_planning_support import (  # noqa: F401
    PREFIX,
    _as,
    _day,
    _project,
    _task,
    pytestmark,
)


def test_a_bar_moves_and_says_which_dependency_it_breaks(client, monkeypatch):
    headers = _as(monkeypatch)
    project = _project(client, headers)
    a = _task(client, headers, "Plan A", project_id=project, start_date=_day(1), due_date=_day(3))
    b = _task(client, headers, "Plan B", project_id=project, start_date=_day(5), due_date=_day(8))
    c = _task(client, headers, "Plan C", project_id=project, start_date=_day(10), due_date=_day(11))

    linked = client.post(f"{PREFIX}/api/work/dependencies", headers=headers,
                         json={"predecessor_id": a["id"], "successor_id": b["id"]})
    assert linked.status_code == 201, linked.get_data(as_text=True)
    assert linked.get_json()["violated"] is False
    assert client.post(f"{PREFIX}/api/work/dependencies", headers=headers,
                       json={"predecessor_id": b["id"], "successor_id": c["id"], "lag_days": 1}).status_code == 201

    # Drag A so it ends after B starts: saved, and the broken link is named.
    moved = client.post(f"{PREFIX}/api/tasks/{a['id']}/schedule", headers=headers,
                        json={"start_date": _day(4), "due_date": _day(6)})
    assert moved.status_code == 200, moved.get_data(as_text=True)
    body = moved.get_json()
    assert body["due_date"] == _day(6)
    assert [item["successor"]["id"] for item in body["violations"]] == [b["id"]]
    assert body["shifted"] == []

    # Shift the dependants: B starts the day after A, C a day after B plus lag.
    shifted = client.post(f"{PREFIX}/api/tasks/{a['id']}/schedule", headers=headers,
                          json={"start_date": _day(4), "due_date": _day(6), "shift_dependants": True})
    assert shifted.status_code == 200
    result = shifted.get_json()
    assert result["violations"] == []
    moves = {item["id"]: item for item in result["shifted"]}
    assert moves[b["id"]]["start_date"] == _day(7) and moves[b["id"]]["due_date"] == _day(10)
    assert moves[c["id"]]["start_date"] == _day(12)

    view = client.get(f"{PREFIX}/api/work/timeline", headers=headers,
                      query_string={"project_id": project, "group": "project"})
    assert view.status_code == 200
    data = view.get_json()
    bars = {item["id"]: item for group in data["groups"] for item in group["items"]}
    assert bars[b["id"]]["start"] == _day(7)
    assert {a["id"], b["id"], c["id"]} <= set(data["critical_path"])
    ours = [link for link in data["dependencies"] if link["predecessor_id"] in (a["id"], b["id"])]
    assert len(ours) == 2 and not any(link["violated"] for link in ours)

    for group in ("epic", "assignee"):
        assert client.get(f"{PREFIX}/api/work/timeline", headers=headers,
                          query_string={"group": group, "from": _day(-5), "to": _day(30), "q": "Plan"}).status_code == 200


def test_dependencies_refuse_loops_duplicates_and_nonsense(client, monkeypatch):
    headers = _as(monkeypatch)
    a = _task(client, headers, "Loop A")
    b = _task(client, headers, "Loop B")
    url = f"{PREFIX}/api/work/dependencies"
    first = client.post(url, headers=headers, json={"predecessor_id": a["id"], "successor_id": b["id"]})
    assert first.status_code == 201
    assert client.post(url, headers=headers, json={"predecessor_id": a["id"], "successor_id": b["id"]}).status_code == 409
    assert client.post(url, headers=headers, json={"predecessor_id": b["id"], "successor_id": a["id"]}).status_code == 400
    assert client.post(url, headers=headers, json={"predecessor_id": a["id"], "successor_id": a["id"]}).status_code == 400
    assert client.post(url, headers=headers, json={"predecessor_id": a["id"], "successor_id": b["id"], "lag_days": "x"}).status_code == 400
    removed = client.delete(f"{url}/{first.get_json()['id']}", headers=headers)
    assert removed.status_code == 200 and removed.get_json()["deleted"] is True
    assert client.delete(f"{url}/{first.get_json()['id']}", headers=headers).status_code == 404


def test_the_timeline_validates_its_window_and_dates(client, monkeypatch):
    headers = _as(monkeypatch)
    assert client.get(f"{PREFIX}/api/work/timeline", headers=headers, query_string={"group": "colour"}).status_code == 400
    assert client.get(f"{PREFIX}/api/work/timeline", headers=headers,
                      query_string={"from": _day(5), "to": _day(1)}).status_code == 400
    assert client.get(f"{PREFIX}/api/work/timeline", headers=headers, query_string={"from": "soon"}).status_code == 400
    task = _task(client, headers, "Backwards")
    back = client.post(f"{PREFIX}/api/tasks/{task['id']}/schedule", headers=headers,
                       json={"start_date": _day(5), "due_date": _day(1)})
    assert back.status_code == 400


def test_a_viewer_reads_the_plan_and_cannot_change_it(client, monkeypatch):
    admin = _as(monkeypatch)
    task = _task(client, admin, "Viewer reads")
    viewer = _as(monkeypatch, "viewer", "viewer")
    view = client.get(f"{PREFIX}/api/work/timeline", headers=viewer)
    assert view.status_code == 200 and view.get_json()["can_edit"] is False
    assert client.post(f"{PREFIX}/api/tasks/{task['id']}/schedule", headers=viewer,
                       json={"start_date": _day(1)}).status_code == 403
    assert client.post(f"{PREFIX}/api/work/sprints", headers=viewer, json={"name": "No"}).status_code == 403
    assert client.put(f"{PREFIX}/api/work/lanes", headers=viewer, json={"IN_PROGRESS": 3}).status_code == 403


def test_a_sprint_is_planned_started_burned_down_and_completed(client, monkeypatch):
    headers = _as(monkeypatch)
    project = _project(client, headers)
    one = _task(client, headers, "Sprint one", project_id=project, story_points=3)
    two = _task(client, headers, "Sprint two", project_id=project, story_points=5)
    three = _task(client, headers, "Sprint three", project_id=project, story_points=8)

    # Any sprint already running on that project is finished first.
    for sprint in client.get(f"{PREFIX}/api/work/sprints", headers=headers,
                             query_string={"project_id": project, "state": "active"}).get_json()["items"]:
        client.post(f"{PREFIX}/api/work/sprints/{sprint['id']}/complete", headers=headers, json={})

    made = client.post(f"{PREFIX}/api/work/sprints", headers=headers,
                       json={"project_id": project, "goal": "Ship it", "start_date": _day(0), "capacity_points": 20})
    assert made.status_code == 201, made.get_data(as_text=True)
    sprint = made.get_json()
    assert sprint["state"] == "PLANNED" and sprint["end_date"] == _day(13)

    # Planning is dragging: into the sprint, between neighbours.
    place = f"{PREFIX}/api/work/backlog/place"
    assert client.post(place, headers=headers, json={"task_id": one["id"], "sprint_id": sprint["id"]}).status_code == 200
    assert client.post(place, headers=headers, json={"task_id": two["id"], "sprint_id": sprint["id"], "after_id": one["id"]}).status_code == 200
    assert client.post(place, headers=headers, json={"task_id": three["id"], "sprint_id": sprint["id"], "before_id": one["id"]}).status_code == 200
    detail = client.get(f"{PREFIX}/api/work/sprints/{sprint['id']}", headers=headers).get_json()
    order = sorted(detail["tasks"], key=lambda item: item["backlog_rank"])
    assert [item["id"] for item in order] == [three["id"], one["id"], two["id"]]
    assert detail["total_points"] == 16

    started = client.post(f"{PREFIX}/api/work/sprints/{sprint['id']}/start", headers=headers, json={})
    assert started.status_code == 200, started.get_data(as_text=True)
    assert started.get_json()["committed_points"] == 16
    assert client.post(f"{PREFIX}/api/work/sprints/{sprint['id']}/start", headers=headers, json={}).status_code == 409
    assert client.delete(f"{PREFIX}/api/work/sprints/{sprint['id']}", headers=headers).status_code == 409

    # Work is done; the burndown moves today.
    client.put(f"{PREFIX}/api/records/task/{one['id']}", headers=headers, json={"status": "DONE"})
    burn = client.get(f"{PREFIX}/api/work/sprints/{sprint['id']}", headers=headers).get_json()["burndown"]
    assert burn["ideal"][0] == 16 and burn["ideal"][-1] == 0
    assert burn["actual"][0] == 13

    client.post(f"{PREFIX}/api/work/scheduler/run", headers=headers)
    done = client.post(f"{PREFIX}/api/work/sprints/{sprint['id']}/complete", headers=headers, json={"carry_over": "new"})
    assert done.status_code == 200, done.get_data(as_text=True)
    report = done.get_json()["report"]
    assert report["completed"] == [one["reference"]]
    assert sorted(report["carried_over"]) == sorted([two["reference"], three["reference"]])
    assert report["carried_to"] != "backlog"
    nxt = client.get(f"{PREFIX}/api/work/sprints/{report['carried_to']['id']}", headers=headers).get_json()
    assert {item["id"] for item in nxt["tasks"]} == {two["id"], three["id"]}

    vel = client.get(f"{PREFIX}/api/work/velocity", headers=headers, query_string={"project_id": project}).get_json()
    assert vel["items"][-1]["completed"] == 3 and vel["items"][-1]["committed"] == 16

    # A finished sprint takes no more work; the next one can be deleted, freeing its tasks.
    assert client.post(place, headers=headers, json={"task_id": one["id"], "sprint_id": sprint["id"]}).status_code == 409
    removed = client.delete(f"{PREFIX}/api/work/sprints/{nxt['id']}", headers=headers)
    assert removed.status_code == 200 and removed.get_json()["released"] == 2
    backlog = client.get(f"{PREFIX}/api/work/backlog", headers=headers,
                         query_string={"project_id": project, "q": "Sprint t"}).get_json()
    assert {two["id"], three["id"]} <= {item["id"] for item in backlog["items"]}


def test_sprint_rules(client, monkeypatch):
    headers = _as(monkeypatch)
    base = f"{PREFIX}/api/work/sprints"
    assert client.post(base, headers=headers, json={"start_date": _day(5), "end_date": _day(1)}).status_code == 400
    assert client.post(base, headers=headers, json={"capacity_points": "lots"}).status_code == 400
    assert client.post(base, headers=headers, json={"project_id": "00000000-0000-0000-0000-000000000000"}).status_code == 404
    assert client.get(base, headers=headers, query_string={"state": "SOON"}).status_code == 400
    team = client.post(base, headers=headers, json={"name": "Team sprint"}).get_json()
    changed = client.put(f"{base}/{team['id']}", headers=headers,
                         json={"name": "Team sprint 1", "goal": "g", "start_date": _day(0), "end_date": _day(6), "capacity_points": 12})
    assert changed.status_code == 200 and changed.get_json()["capacity_points"] == 12
    assert client.put(f"{base}/{team['id']}", headers=headers, json={"name": " "}).status_code == 400
    assert client.post(f"{base}/{team['id']}/complete", headers=headers, json={}).status_code == 409
    other = client.post(base, headers=headers, json={"name": "Other"}).get_json()
    started = client.post(f"{base}/{team['id']}/start", headers=headers, json={"goal": "Go"})
    if started.status_code == 200:
        assert client.post(f"{base}/{other['id']}/start", headers=headers, json={}).status_code == 409
        assert client.post(f"{base}/{team['id']}/complete", headers=headers, json={"carry_over": "nowhere-real"}).status_code == 400
        assert client.post(f"{base}/{team['id']}/complete", headers=headers, json={"carry_over": "next"}).status_code == 200
    assert client.get(f"{base}/00000000-0000-0000-0000-000000000000", headers=headers).status_code == 404
    listing = client.get(base, headers=headers).get_json()
    assert listing["can_manage"] is True and listing["items"]
