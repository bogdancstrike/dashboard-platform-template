"""Dashboards: a layout of widgets, saved and shared (§45, §67). — referencing widget."""

from __future__ import annotations

from uuid import uuid4

import pytest

from tests.dashboards_support import (  # noqa: F401
    DASHBOARDS,
    _authenticate,
    scratch,
)


@pytest.mark.database
def test_a_referencing_widget_takes_its_dataset_from_what_it_names(client, scratch):
    dashboard, headers = scratch

    # Unnamed is a placeholder, like any other kind — the card says it has
    # nothing to draw yet.
    nameless = client.post(
        f"{DASHBOARDS}/{dashboard['id']}/widgets",
        json={"kind": "REPORT", "title": "Nothing yet", "config": {}},
        headers=headers,
    )
    assert nameless.status_code == 201
    assert "report_id" not in nameless.get_json()["widgets"][0]["config"]

    # And it takes its dataset from the thing it names, rather than carrying a
    # second opinion about which dataset that is.
    conflicting = client.post(
        f"{DASHBOARDS}/{dashboard['id']}/widgets",
        json={
            "kind": "SEARCH",
            "title": "Both",
            "config": {"search_id": str(uuid4()), "entity": "order"},
        },
        headers=headers,
    )
    assert conflicting.status_code == 400


def test_the_seeded_layouts_do_not_overlap():
    """A seeded dashboard opens as something readable rather than a pile.

    The row used to advance by the *last* widget placed rather than the tallest
    in it, so a full-width panel three rows tall followed by a row of tiles put
    the tiles inside it — and the grid then had to push them out, which is what
    left every seeded dashboard full of holes.
    """
    from src.seed import runner
    from src.seed.world import SCALES

    world = runner.generate(scale=SCALES["small"], seed=1234)
    by_dashboard: dict[str, list] = {}
    for widget in world.dashboard_widgets:
        by_dashboard.setdefault(str(widget.dashboard_id), []).append(widget)

    assert by_dashboard, "the seed produced no dashboards to check"
    for widgets in by_dashboard.values():
        # Every cell claimed at most once. A set of occupied (column, row)
        # pairs is the whole test: two widgets sharing one is an overlap.
        occupied: set[tuple[int, int]] = set()
        for widget in widgets:
            for column in range(widget.x, widget.x + widget.width):
                for row in range(widget.y, widget.y + widget.height):
                    cell = (column, row)
                    assert cell not in occupied, f"{widget.title} overlaps at {cell}"
                    occupied.add(cell)
            assert widget.x + widget.width <= 12


def test_the_seed_only_writes_scopes_the_sharing_model_knows():
    """One sharing model means one vocabulary, everywhere that writes a scope.

    The seed carried a broader ladder — `TEAM`, `ORGANIZATION` — for an
    audience nothing implements. `sharing.visibility` has no branch for either,
    so a seeded dashboard scoped `TEAM` was invisible to everybody but its
    owner and any edit touching its scope was refused against a vocabulary it
    was not in. Silent, and exactly the kind of drift a second vocabulary
    causes.
    """
    from src.core.sharing import SCOPES
    from src.seed import personal, runner
    from src.seed.world import SCALES

    assert {scope for scope, _weight in personal.SCOPES} <= SCOPES
    assert {scope for scope, _weight in personal.SEARCH_SCOPES} <= SCOPES

    world = runner.generate(scale=SCALES["small"], seed=99)
    for saved in (*world.dashboards, *world.reports, *world.saved_searches):
        assert saved.scope in SCOPES, f"{saved.name} is scoped {saved.scope}"


def test_every_persona_owns_exactly_one_home_dashboard():
    """§67 is "one dashboard is *your* home page".

    It cannot be demonstrated by signing in as somebody who owns none: the page
    falls back to a colleague's public one, which is right behaviour and a poor
    demonstration. So the five personas get the first five dashboards, one
    each, rather than owners drawn at random.
    """
    from src.seed import runner
    from src.seed.world import SCALES

    world = runner.generate(scale=SCALES["small"], seed=7)
    homes: dict[str, int] = {}
    for dashboard in world.dashboards:
        if dashboard.is_home:
            homes[str(dashboard.owner_id)] = homes.get(str(dashboard.owner_id), 0) + 1

    persona_ids = {str(persona.id) for persona in world.personas.values()}
    assert set(homes) == persona_ids
    assert set(homes.values()) == {1}


@pytest.mark.database
def test_a_dashboard_can_be_created_already_holding_something(client, monkeypatch):
    """A dashboard is created *in order to hold* something.

    An empty one is a thing somebody then has to furnish, and a create flow
    that ends on an empty grid has stopped one step short. Laid out by the same
    rule the grid's compaction uses, so the result is tidy without anybody
    dragging.
    """
    headers = _authenticate(monkeypatch)
    created = client.post(
        DASHBOARDS,
        json={
            "name": f"Populated {uuid4().hex[:6]}",
            "widgets": [
                {"kind": "KPI", "title": "Open tickets", "config": {"entity": "ticket"}},
                {"kind": "KPI", "title": "Revenue", "config": {"entity": "order"}},
                {"kind": "KPI", "config": {"entity": "task"}},
                {"kind": "KPI", "config": {"entity": "project"}},
                {"kind": "ALERTS", "config": {}},
                {"kind": "BAR_CHART", "config": {"entity": "ticket"}},
            ],
        },
        headers=headers,
    )
    assert created.status_code == 201, created.get_json()
    body = created.get_json()

    try:
        assert body["widget_count"] == 6
        widgets = body["widgets"]
        # Four three-column tiles fill the first row, then the row advances by
        # the tallest widget in it rather than by the last one placed.
        assert [w["x"] for w in widgets[:4]] == [0, 3, 6, 9]
        assert all(w["y"] == 0 for w in widgets[:4])
        assert widgets[4]["y"] == 1

        # A widget with no title gets one that names its subject rather than
        # its shape: a card headed "KPI" says nothing.
        assert widgets[2]["title"] == "Headline number"

        # And the listing says *what* it holds, not only how much.
        listed = next(
            item
            for item in client.get(DASHBOARDS, headers=headers).get_json()["items"]
            if item["id"] == body["id"]
        )
        assert listed["widget_kinds"] == ["ALERTS", "BAR_CHART", "KPI"]
    finally:
        client.delete(f"{DASHBOARDS}/{body['id']}", headers=headers)


@pytest.mark.database
def test_creating_with_a_kind_the_platform_cannot_draw_creates_nothing(client, monkeypatch):
    """All or nothing: a dashboard half-built from a bad request is worse than
    a request that failed."""
    headers = _authenticate(monkeypatch)
    name = f"Refused {uuid4().hex[:6]}"
    response = client.post(
        DASHBOARDS,
        json={"name": name, "widgets": [{"kind": "KPI", "config": {"entity": "task"}},
                                        {"kind": "SANKEY", "config": {}}]},
        headers=headers,
    )
    assert response.status_code == 400
    assert "KPI" in response.get_json()["details"]["allowed"]

    listed = client.get(DASHBOARDS, headers=headers).get_json()["items"]
    assert name not in {item["name"] for item in listed}


def test_every_kind_declares_a_size_and_a_name():
    """The picker offers what the server accepts, at the size it will get.

    A kind added to `WIDGET_KINDS` without either is one the create flow lays
    out at a guessed size under a heading that names its shape.
    """
    from src.services.analytics.dashboards import _TITLES, DEFAULT_SIZES, WIDGET_KINDS

    assert WIDGET_KINDS - set(DEFAULT_SIZES) == frozenset()
    assert WIDGET_KINDS - set(_TITLES) == frozenset()
    for kind, (width, height) in DEFAULT_SIZES.items():
        assert 1 <= width <= 12, kind
        assert 1 <= height <= 8, kind
