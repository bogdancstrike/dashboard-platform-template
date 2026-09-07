"""Dashboards: a layout of widgets, saved and shared (§45, §67).

What is worth asserting is what makes a layout trustworthy rather than
decorative: that a grid cannot be saved rendering on top of itself, that one
person has one home, that the sharing rules are the *same* rules saved searches
and reports follow, and that this service computes no aggregates of its own —
a widget names a question, and the endpoint that owns that question answers it.
"""

from __future__ import annotations

from uuid import uuid4

import pytest

from src.config import Config
from tests.conftest import persona_claims

PREFIX = Config.API_PREFIX
DASHBOARDS = f"{PREFIX}/api/dashboards"


def _authenticate(monkeypatch, username: str = "admin", role: str = "administrator"):
    monkeypatch.setattr(
        "src.core.auth.verify_token",
        lambda _token: persona_claims(username, role, sid=f"dash-{username}"),
    )
    return {"Authorization": f"Bearer dash-{username}"}


@pytest.fixture()
def scratch(client, monkeypatch, has_database):
    """A dashboard this test owns, removed however the test ends.

    The suite runs against the same PostgreSQL the application serves, so a
    test that leaves rows behind changes what the next person to open the demo
    sees.
    """
    if not has_database:
        pytest.skip("needs PostgreSQL")
    headers = _authenticate(monkeypatch)
    created = client.post(
        DASHBOARDS, json={"name": f"Scratch {uuid4().hex[:8]}"}, headers=headers
    )
    assert created.status_code == 201, created.get_json()
    body = created.get_json()

    yield body, headers

    client.delete(f"{DASHBOARDS}/{body['id']}", headers=_authenticate(monkeypatch))


def test_dashboards_need_a_bearer_token(client):
    assert client.get(DASHBOARDS).status_code == 401
    assert client.post(DASHBOARDS, json={}).status_code == 401


@pytest.mark.database
def test_the_listing_publishes_what_a_builder_may_offer(client, monkeypatch):
    """A builder that offers a widget kind the server refuses is a builder
    whose last step fails."""
    body = client.get(DASHBOARDS, headers=_authenticate(monkeypatch)).get_json()

    assert body["columns"] == 12
    assert "KPI" in body["widget_kinds"]
    assert "AREA_CHART" in body["widget_kinds"]
    # Only the datasets this reader may actually read, so a widget cannot be
    # pointed at one that would always answer forbidden.
    assert {item["key"] for item in body["datasets"]} >= {"task", "ticket", "order"}


@pytest.mark.database
def test_a_widget_is_placed_where_it_was_dropped_and_reads_back_the_same(client, scratch):
    dashboard, headers = scratch

    added = client.post(
        f"{DASHBOARDS}/{dashboard['id']}/widgets",
        json={
            "kind": "BAR_CHART",
            "title": "Tickets by severity",
            "x": 6,
            "y": 2,
            "width": 6,
            "height": 3,
            "config": {"entity": "ticket", "dimension": "severity", "period": "last_30_days"},
        },
        headers=headers,
    )
    assert added.status_code == 201, added.get_json()

    widgets = added.get_json()["widgets"]
    assert len(widgets) == 1
    assert widgets[0]["x"] == 6
    assert widgets[0]["width"] == 6
    # The question travels with the card: this service stores it and the
    # analysis endpoint answers it.
    assert widgets[0]["config"]["entity"] == "ticket"
    assert widgets[0]["config"]["dimension"] == "severity"


@pytest.mark.database
def test_a_widget_that_would_hang_off_the_grid_is_refused_not_clamped(client, scratch):
    """A card silently narrowed on save is a layout the reader did not choose
    and cannot undo."""
    dashboard, headers = scratch

    response = client.post(
        f"{DASHBOARDS}/{dashboard['id']}/widgets",
        json={"kind": "KPI", "title": "Too wide", "x": 9, "width": 6,
              "config": {"entity": "task"}},
        headers=headers,
    )
    assert response.status_code == 400
    details = response.get_json()["details"]
    assert details["x"] == 9 and details["width"] == 6 and details["columns"] == 12


@pytest.mark.database
def test_a_widget_names_a_dataset_it_reads_or_none_at_all(client, scratch):
    dashboard, headers = scratch

    missing = client.post(
        f"{DASHBOARDS}/{dashboard['id']}/widgets",
        json={"kind": "KPI", "title": "Nothing", "config": {}},
        headers=headers,
    )
    assert missing.status_code == 400

    # An alert strip is a platform-wide feed; naming a dataset on one is a
    # config that would be silently ignored.
    spurious = client.post(
        f"{DASHBOARDS}/{dashboard['id']}/widgets",
        json={"kind": "ALERTS", "title": "Alerts", "config": {"entity": "task"}},
        headers=headers,
    )
    assert spurious.status_code == 400

    plain = client.post(
        f"{DASHBOARDS}/{dashboard['id']}/widgets",
        json={"kind": "ALERTS", "title": "Alerts", "config": {}},
        headers=headers,
    )
    assert plain.status_code == 201


@pytest.mark.database
def test_a_kind_the_platform_cannot_draw_is_refused_with_the_list(client, scratch):
    dashboard, headers = scratch

    response = client.post(
        f"{DASHBOARDS}/{dashboard['id']}/widgets",
        json={"kind": "SANKEY", "title": "Flow", "config": {"entity": "order"}},
        headers=headers,
    )
    assert response.status_code == 400
    assert "KPI" in response.get_json()["details"]["allowed"]


@pytest.mark.database
def test_one_drag_saves_the_whole_layout(client, scratch):
    """Dragging a widget reflows the ones around it; five separate writes let a
    reader reload between them and find a layout that never existed."""
    dashboard, headers = scratch
    for index in range(2):
        client.post(
            f"{DASHBOARDS}/{dashboard['id']}/widgets",
            json={"kind": "KPI", "title": f"Tile {index}", "x": index * 3, "width": 3,
                  "height": 1, "config": {"entity": "task"}},
            headers=headers,
        )

    current = client.get(f"{DASHBOARDS}/{dashboard['id']}", headers=headers).get_json()
    swapped = [
        {"id": current["widgets"][1]["id"], "x": 0, "y": 0, "width": 3, "height": 1},
        {"id": current["widgets"][0]["id"], "x": 3, "y": 0, "width": 3, "height": 1},
    ]

    response = client.put(
        f"{DASHBOARDS}/{dashboard['id']}/arrange", json={"widgets": swapped}, headers=headers
    )
    assert response.status_code == 200

    after = client.get(f"{DASHBOARDS}/{dashboard['id']}", headers=headers).get_json()
    assert [widget["title"] for widget in after["widgets"]] == ["Tile 1", "Tile 0"]
    assert [widget["x"] for widget in after["widgets"]] == [0, 3]


@pytest.mark.database
def test_arranging_a_widget_from_another_dashboard_is_refused(client, scratch):
    dashboard, headers = scratch
    response = client.put(
        f"{DASHBOARDS}/{dashboard['id']}/arrange",
        json={"widgets": [{"id": str(uuid4()), "x": 0, "y": 0, "width": 3, "height": 1}]},
        headers=headers,
    )
    assert response.status_code == 400
    assert "dashboard" in response.get_json()["details"]


@pytest.mark.database
def test_one_person_has_one_home(client, monkeypatch):
    """Two homes is a preference that cannot be honoured (§67)."""
    headers = _authenticate(monkeypatch)
    first = client.post(
        DASHBOARDS, json={"name": f"Home A {uuid4().hex[:6]}", "is_home": True}, headers=headers
    ).get_json()
    second = client.post(
        DASHBOARDS, json={"name": f"Home B {uuid4().hex[:6]}", "is_home": True}, headers=headers
    ).get_json()

    try:
        assert second["is_home"] is True
        reread = client.get(f"{DASHBOARDS}/{first['id']}", headers=headers).get_json()
        assert reread["is_home"] is False

        homes = [
            item
            for item in client.get(DASHBOARDS, headers=headers).get_json()["items"]
            if item["is_home"] and item["owner"]["name"] == "Ada Administrator"
        ]
        assert len(homes) == 1
    finally:
        for created in (first, second):
            client.delete(f"{DASHBOARDS}/{created['id']}", headers=headers)


@pytest.mark.database
def test_a_private_dashboard_is_invisible_to_a_colleague(client, monkeypatch, scratch):
    dashboard, _ = scratch

    other = _authenticate(monkeypatch, "manager", "manager")
    assert client.get(f"{DASHBOARDS}/{dashboard['id']}", headers=other).status_code == 404
    listed = client.get(DASHBOARDS, headers=other).get_json()
    assert dashboard["id"] not in {item["id"] for item in listed["items"]}


@pytest.mark.database
def test_a_public_dashboard_is_readable_by_everyone_and_writable_by_its_owner(
    client, monkeypatch, scratch
):
    dashboard, headers = scratch
    client.put(f"{DASHBOARDS}/{dashboard['id']}", json={"scope": "PUBLIC"}, headers=headers)

    other = _authenticate(monkeypatch, "manager", "manager")
    read = client.get(f"{DASHBOARDS}/{dashboard['id']}", headers=other)
    assert read.status_code == 200
    assert read.get_json()["can_edit"] is False

    # Only the owner writes — the same rule saved searches and reports follow.
    refused = client.put(
        f"{DASHBOARDS}/{dashboard['id']}", json={"name": "Theirs now"}, headers=other
    )
    assert refused.status_code == 403
    assert "owner" in refused.get_json()["message"].lower()


@pytest.mark.database
def test_the_delete_says_what_went(client, monkeypatch):
    """A request that reports failure having succeeded is worse than one that
    fails — so the body is asserted, not only that the row went."""
    headers = _authenticate(monkeypatch)
    created = client.post(
        DASHBOARDS, json={"name": f"Doomed {uuid4().hex[:6]}"}, headers=headers
    ).get_json()

    response = client.delete(f"{DASHBOARDS}/{created['id']}", headers=headers)
    assert response.status_code == 200
    assert response.get_json() == {
        "id": created["id"], "deleted": True, "name": created["name"],
    }
    assert client.get(f"{DASHBOARDS}/{created['id']}", headers=headers).status_code == 404


@pytest.mark.database
def test_home_is_this_readers_home_and_not_the_owners(client, monkeypatch, scratch):
    """The column records a preference belonging to whoever owns the dashboard.

    Published raw, it put a home marker on a colleague's public dashboard —
    which told the reader something false about their own settings (§67).
    """
    dashboard, headers = scratch
    client.put(
        f"{DASHBOARDS}/{dashboard['id']}",
        json={"is_home": True, "scope": "PUBLIC"},
        headers=headers,
    )

    mine = client.get(f"{DASHBOARDS}/{dashboard['id']}", headers=headers).get_json()
    assert mine["is_home"] is True

    theirs = client.get(
        f"{DASHBOARDS}/{dashboard['id']}", headers=_authenticate(monkeypatch, "manager", "manager")
    ).get_json()
    assert theirs["is_home"] is False
