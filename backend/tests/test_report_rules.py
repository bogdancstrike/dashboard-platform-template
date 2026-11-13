"""A saved report's definition is checked on write, field by field.

`test_reports` covers listing, running and sharing. These pin what the editor
can send and what it gets back for each mistake — the shape conversions
(`[{field, granularity}]` → `"field:granularity"`), the limits (two groupings,
four measures), the period and visualization vocabularies — and partial edits
that clear a value.
"""

from __future__ import annotations

import pytest

from src.services import reports as service
from tests.personas import PREFIX, as_each

REPORTS = f"{PREFIX}/api/reports"

pytestmark = pytest.mark.database


def _report(**fields):
    return {"name": "Rules probe", "resource_type": "task", **fields}


@pytest.mark.parametrize(("body", "says"), [
    (_report(colour="red"), "Unknown report field"),
    (_report(name="   "), "1 to 200"),
    (_report(name="x" * 201), "1 to 200"),
    (_report(resource_type="nowhere"), ""),
    (_report(dimensions="status"), "dimensions must be an array"),
    (_report(dimensions=["status", "priority", "project_id"]), "at most two"),
    (_report(dimensions=[{"granularity": "month"}]), "needs a field"),
    (_report(metrics="count"), "metrics must be an array"),
    (_report(metrics=["count"] * 5), "at most four"),
    (_report(metrics=[42]), "object or a string"),
    (_report(filters=["status"]), "filters must be an object"),
    (_report(condition_tree="status = OPEN"), "condition_tree"),
    (_report(period="the before times"), ""),
    (_report(visualization="hologram"), "Unknown visualization"),
    (_report(order="sideways"), "asc or desc"),
])
def test_a_bad_definition_is_refused_with_its_reason(client, monkeypatch, body, says):
    admin = as_each(monkeypatch)("admin")
    response = client.post(REPORTS, json=body, headers=admin)
    assert response.status_code in (400, 404), response.get_json()
    assert says.lower() in response.get_json()["message"].lower()


def test_shapes_are_folded_and_a_partial_edit_clears_what_it_names(client, monkeypatch):
    admin = as_each(monkeypatch)("admin")
    created = client.post(REPORTS, json=_report(
        name="  Rules   probe  ", description="  why ",
        dimensions=[{"field": "created_at", "granularity": "month"}, "status"],
        metrics=[{"aggregation": "COUNT"}, {"kind": "sum", "field": "progress"}, "avg:progress"],
        filters=None, condition_tree=None, visualization="LINE", sort=" title ", order="ASC",
    ), headers=admin)
    assert created.status_code == 201, created.get_json()
    report = created.get_json()
    assert report["name"] == "Rules probe" and report["description"] == "why"
    dims = lambda body: [(d["field"], d["granularity"]) for d in body["dimensions"]]  # noqa: E731
    mets = lambda body: [(m["aggregation"], m.get("field") or "") for m in body["metrics"]]  # noqa: E731
    assert dims(report) == [("created_at", "month"), ("status", "")]
    assert mets(report) == [("count", ""), ("sum", "progress"), ("avg", "progress")]
    assert report["visualization"] == "line" and report["order"] == "asc"

    edited = client.put(f"{REPORTS}/{report['id']}", json={"description": "", "sort": "", "metrics": []},
                        headers=admin)
    assert edited.status_code == 200, edited.get_json()
    after = edited.get_json()
    assert after["description"] is None and after["sort"] is None and mets(after) == [("count", "")]
    assert dims(after) == [("created_at", "month"), ("status", "")]  # untouched

    listed = client.get(f"{REPORTS}?resource_type=task", headers=admin).get_json()
    assert all(item["resource_type"] == "task" for item in listed["items"])
    assert report["id"] in {item["id"] for item in listed["items"]}
    assert client.get(f"{REPORTS}?resource_type=nowhere", headers=admin).status_code in (400, 404)
    assert client.put(f"{REPORTS}/{report['id']}", json=["x"], headers=admin).status_code == 400


def test_sharing_with_named_people_needs_the_share_permission(client, monkeypatch, app):
    from dataclasses import replace

    from src.core.db import session_scope
    from src.core.errors import ForbiddenError
    from tests.personas import principal

    admin = principal(app, "admin")
    narrowed = replace(admin, permissions=frozenset(p for p in admin.permissions if p != service.SHARE_PERMISSION))
    with session_scope() as session:
        with pytest.raises(ForbiddenError):
            service._validated(_report(member_ids=[str(admin.user_id)]), principal=narrowed, partial=False)
        session.rollback()


def test_the_shape_helpers_accept_strings_as_they_are():
    assert service._dimensions(["placed_at:week"]) == ["placed_at:week"]
    assert service._metrics([]) == ["count"]
    assert service._metrics([{"aggregation": "max", "field": "total"}]) == ["max:total"]
