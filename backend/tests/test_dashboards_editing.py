"""Dashboards (§45, §67): the edits around a layout.

`test_dashboards` asserts the grid's invariants. These cover the rest of the
builder's surface — starting a dashboard with widgets, copying one, editing
and removing a single widget, and every refusal that keeps a config honest.
"""

from __future__ import annotations

from uuid import uuid4

import pytest

from src.config import Config
from tests.conftest import persona_claims

PREFIX = Config.API_PREFIX
DASHBOARDS = f"{PREFIX}/api/dashboards"
MISSING = "00000000-0000-0000-0000-000000000000"

pytestmark = pytest.mark.database


def _authenticate(monkeypatch, username: str = "admin", role: str = "administrator"):
    monkeypatch.setattr(
        "src.core.auth.tokens.verify_token",
        lambda _token: persona_claims(username, role, sid=f"dash-edit-{username}"),
    )
    return {"Authorization": f"Bearer dash-edit-{username}"}


def _create(client, headers, **payload):
    payload.setdefault("name", f"Editing {uuid4().hex[:8]}")
    response = client.post(DASHBOARDS, json=payload, headers=headers)
    assert response.status_code == 201, response.get_data(as_text=True)
    return response.get_json()


def test_a_dashboard_starts_with_the_widgets_it_was_asked_for(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    body = _create(
        client,
        headers,
        description="what the week looks like",
        icon="chart",
        filters={"period": "7d"},
        widgets=[
            {"kind": "kpi", "config": {"entity": "task"}},
            {"kind": "KPI"},
            {"kind": "KPI"},
            {"kind": "KPI"},
            {"kind": "BAR_CHART", "title": "Wrapped onto the next row"},
            {"kind": "CALENDAR", "config": {"days": "999", "ignored": True}},
            {"kind": "TASKS", "config": {"mine": 1, "status": "open", "board_id": MISSING}},
            {"kind": "EXPLORER", "config": {"entity": "ticket"}},
            {"kind": "REPORT", "config": {"report_id": MISSING}},
            {"kind": "SEARCH", "config": {"search_id": ""}},
        ],
    )
    widgets = sorted(body["widgets"], key=lambda item: item["position"])
    assert [item["kind"] for item in widgets][:2] == ["KPI", "KPI"]
    # Laid out left to right, wrapping when the row is full.
    assert len({(item["x"], item["y"]) for item in widgets}) == len(widgets)
    assert max(item["y"] for item in widgets) > 0
    calendar = next(item for item in widgets if item["kind"] == "CALENDAR")
    assert calendar["config"] == {"days": 365}, "clamped, and unknown keys dropped"
    tasks = next(item for item in widgets if item["kind"] == "TASKS")
    assert tasks["config"] == {"board_id": MISSING, "mine": True, "status": "open"}
    search = next(item for item in widgets if item["kind"] == "SEARCH")
    assert "search_id" not in search["config"]


@pytest.mark.parametrize(
    "payload",
    [
        {"widgets": "not-a-list"},
        {"widgets": [{"kind": "KPI"}] * 40},
        {"widgets": ["not-an-object"]},
        {"widgets": [{"kind": "SPARKLER"}]},
        {"widgets": [{"kind": "ACTIVITY", "config": {"entity": "task"}}]},
        {"widgets": [{"kind": "REPORT", "config": {"entity": "task"}}]},
        {"widgets": [{"kind": "REPORT", "config": {"report_id": "nope"}}]},
        {"widgets": [{"kind": "KPI", "config": {"filters": "status=open"}}]},
        {"widgets": [{"kind": "CALENDAR", "config": {"days": "a week"}}]},
        {"widgets": [{"kind": "EXPLORER", "config": {"entity": "no-such-dataset"}}]},
        {"filters": "not-an-object"},
        {"name": "  "},
    ],
)
def test_a_dashboard_with_an_impossible_start_is_refused(client, monkeypatch, payload):
    headers = _authenticate(monkeypatch)
    body = {"name": f"Refused {uuid4().hex[:6]}", **payload}
    response = client.post(DASHBOARDS, json=body, headers=headers)
    assert response.status_code in (400, 403, 404), response.get_data(as_text=True)


def test_a_body_that_is_not_an_object_is_refused(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    assert client.post(DASHBOARDS, json=["x"], headers=headers).status_code == 400


def test_a_copy_is_private_carries_the_widgets_and_takes_a_free_name(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    name = f"Original {uuid4().hex[:6]}"
    original = _create(client, headers, name=name, widgets=[{"kind": "KPI"}, {"kind": "LIST"}])

    first = client.post(f"{DASHBOARDS}/{original['id']}/duplicate", headers=headers)
    assert first.status_code == 201, first.get_data(as_text=True)
    copy = first.get_json()
    assert copy["name"] == f"{name} (2)"
    assert copy["scope"] == "PRIVATE"
    assert sorted(w["kind"] for w in copy["widgets"]) == ["KPI", "LIST"]

    second = client.post(f"{DASHBOARDS}/{original['id']}/duplicate", headers=headers).get_json()
    assert second["name"] == f"{name} (3)"

    # Somebody else's copy keeps the original name: it is theirs, and they
    # have nothing called that yet.
    shared = client.put(
        f"{DASHBOARDS}/{original['id']}", json={"scope": "PUBLIC"}, headers=headers
    )
    assert shared.status_code == 200, shared.get_data(as_text=True)
    # `_authenticate` patches token verification itself, so from here every
    # request is the manager's.
    manager = _authenticate(monkeypatch, "manager", "manager")
    adopted = client.post(f"{DASHBOARDS}/{original['id']}/duplicate", headers=manager)
    assert adopted.status_code == 201, adopted.get_data(as_text=True)
    assert adopted.get_json()["name"] == name
    client.delete(f"{DASHBOARDS}/{adopted.get_json()['id']}", headers=manager)


def test_a_dashboard_is_edited_in_place(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    board = _create(client, headers)
    response = client.put(
        f"{DASHBOARDS}/{board['id']}",
        json={
            "description": "",
            "icon": "",
            "is_home": False,
            "member_ids": [],
            "filters": None,
        },
        headers=headers,
    )
    assert response.status_code == 200, response.get_data(as_text=True)
    body = response.get_json()
    assert body["description"] is None and body["is_home"] is False


def test_one_widget_is_changed_moved_and_removed(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    board = _create(client, headers, widgets=[{"kind": "KPI"}, {"kind": "LIST"}])
    kpi = next(item for item in board["widgets"] if item["kind"] == "KPI")
    url = f"{DASHBOARDS}/{board['id']}/widgets/{kpi['id']}"

    for payload in (
        {"title": ""},
        {"kind": "NOPE"},
        {"width": "wide"},
        {"width": 0},
        {"height": 99},
        {"x": -1},
        {"x": 11, "width": 4},
        ["not-an-object"],
    ):
        response = client.put(url, json=payload, headers=headers)
        assert response.status_code == 400, (payload, response.get_data(as_text=True))

    changed = client.put(
        url,
        json={"title": "Open work", "subtitle": "right now", "width": 6, "x": 0, "y": 0},
        headers=headers,
    )
    assert changed.status_code == 200, changed.get_data(as_text=True)
    edited = next(item for item in changed.get_json()["widgets"] if item["id"] == kpi["id"])
    assert edited["title"] == "Open work" and edited["width"] == 6
    assert edited["subtitle"] == "right now"

    missing = client.put(
        f"{DASHBOARDS}/{board['id']}/widgets/{MISSING}", json={"title": "x"}, headers=headers
    )
    assert missing.status_code == 404

    removed = client.delete(url, headers=headers)
    assert removed.status_code == 200
    assert kpi["id"] not in {item["id"] for item in removed.get_json()["widgets"]}


def test_an_arrangement_names_only_widgets_on_the_dashboard(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    board = _create(client, headers, widgets=[{"kind": "KPI"}])
    url = f"{DASHBOARDS}/{board['id']}/arrange"
    assert client.put(url, json={"widgets": []}, headers=headers).status_code == 400
    assert client.put(url, json={"widgets": ["x"]}, headers=headers).status_code == 400
    assert client.put(url, json={"widgets": [{"id": MISSING}]}, headers=headers).status_code == 400


def test_a_module_the_role_cannot_open_cannot_be_added():
    """Adding a card that could only ever say "forbidden" is refused up front."""
    from src.core.errors import ValidationError
    from src.services.analytics import dashboards

    class Reader:
        def can(self, *_permissions):
            return False

    with pytest.raises(ValidationError) as refused:
        dashboards._config({}, kind="MAIL", principal=Reader())
    assert refused.value.details["permission"] == "mail.access"
    # A module that needs nothing beyond signing in is always allowed.
    assert dashboards._config({"unread_only": 1}, kind="NOTIFICATIONS", principal=Reader()) == {
        "unread_only": True
    }
