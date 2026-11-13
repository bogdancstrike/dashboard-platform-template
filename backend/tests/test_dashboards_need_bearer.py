"""Dashboards: a layout of widgets, saved and shared (§45, §67). — need bearer."""

from __future__ import annotations

from uuid import uuid4

import pytest

from tests.dashboards_support import (  # noqa: F401
    DASHBOARDS,
    PREFIX,
    _authenticate,
    scratch,
)


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
def test_a_widget_nobody_placed_lands_under_the_others_not_on_top_of_them(client, scratch):
    """Adding a card must not rearrange the cards already there.

    Every caller that is not a drag sends no geometry: the widget drawer, and
    "add this saved chart to a dashboard" from the reports page. Those used to
    land at `(0, 0)` — on top of the first card — and the grid's vertical
    compaction then pushed the whole dashboard down a row to make room. The
    reader arranged that layout; adding something to the bottom of it is not a
    licence to move the rest.
    """
    dashboard, headers = scratch

    def add(title: str) -> dict:
        added = client.post(
            f"{DASHBOARDS}/{dashboard['id']}/widgets",
            json={"kind": "BAR_CHART", "title": title, "config": {"entity": "ticket"}},
            headers=headers,
        )
        assert added.status_code == 201, added.get_json()
        return added.get_json()

    first = add("First")["widgets"][0]
    assert (first["x"], first["y"]) == (0, 0)

    widgets = {w["title"]: w for w in add("Second")["widgets"]}
    # Below the first, by exactly its height, and the first has not moved.
    assert (widgets["First"]["x"], widgets["First"]["y"]) == (0, 0)
    assert widgets["Second"]["x"] == 0
    assert widgets["Second"]["y"] == first["y"] + first["height"]

    # A caller that *does* say where it goes still gets what it asked for.
    dropped = client.post(
        f"{DASHBOARDS}/{dashboard['id']}/widgets",
        json={"kind": "KPI", "title": "Dropped", "x": 6, "y": 0, "config": {"entity": "ticket"}},
        headers=headers,
    ).get_json()
    placed = next(w for w in dropped["widgets"] if w["title"] == "Dropped")
    assert (placed["x"], placed["y"]) == (6, 0)


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
def test_a_widget_may_be_created_before_it_has_a_subject(client, scratch):
    """The create flow picks *shapes*, and each is filled in on the grid.

    Requiring a dataset up front would mean choosing thirteen datasets in a
    modal before seeing a single card. So an unconfigured widget is stored, and
    the card says in place that it still needs a subject (§34).
    """
    dashboard, headers = scratch

    placeholder = client.post(
        f"{DASHBOARDS}/{dashboard['id']}/widgets",
        json={"kind": "KPI", "title": "Nothing yet", "config": {}},
        headers=headers,
    )
    assert placeholder.status_code == 201, placeholder.get_json()
    assert placeholder.get_json()["widgets"][0]["config"] == {}

    # What *is* named still has to be askable: a dataset that does not exist is
    # refused whether it arrives now or later.
    nonsense = client.post(
        f"{DASHBOARDS}/{dashboard['id']}/widgets",
        json={"kind": "KPI", "title": "Wrong", "config": {"entity": "invoice"}},
        headers=headers,
    )
    assert nonsense.status_code == 400
    assert "available" in nonsense.get_json()["details"]


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


@pytest.mark.database
def test_a_saved_chart_becomes_a_widget_without_being_rebuilt(client, monkeypatch, scratch):
    """The point of the referencing kinds (§45).

    A chart composed in the chart builder is a saved report. Pointing a widget
    at it inherits its definition, its sharing and its audit trail; describing
    the same question again in a widget config would be a second copy that
    drifts the first time either is edited.
    """
    dashboard, headers = scratch
    report = client.post(
        f"{PREFIX}/api/reports",
        json={
            "name": f"Widget source {uuid4().hex[:6]}",
            "resource_type": "order",
            "dimensions": ["status"],
            "metrics": [{"aggregation": "count"}],
            "visualization": "bar",
        },
        headers=headers,
    ).get_json()

    try:
        added = client.post(
            f"{DASHBOARDS}/{dashboard['id']}/widgets",
            json={
                "kind": "REPORT",
                "title": "Orders by status",
                "width": 6,
                "height": 2,
                "config": {"report_id": report["id"]},
            },
            headers=headers,
        )
        assert added.status_code == 201, added.get_json()
        assert added.get_json()["widgets"][0]["config"]["report_id"] == report["id"]
    finally:
        client.delete(f"{PREFIX}/api/reports/{report['id']}", headers=headers)
