"""Data Explorer HTTP contract: auth, SQL queries and saved visibility. — insights (§44, §71)."""

from __future__ import annotations

from uuid import uuid4

import pytest
from sqlalchemy import func, select

from tests.explorer_support import (  # noqa: F401
    PREFIX,
    _authenticate,
)


@pytest.mark.database
def test_insights_summarise_the_dataset_from_its_declaration(client, monkeypatch):
    """Adding a headline number is a declaration, not an endpoint and a page."""
    response = client.post(
        f"{PREFIX}/api/explorer/insights",
        headers=_authenticate(monkeypatch),
        json={"resource_type": "order"},
    )

    assert response.status_code == 200
    body = response.get_json()

    metrics = {metric["key"]: metric for metric in body["metrics"]}
    assert metrics["revenue"]["format"] == "currency"
    assert metrics["revenue"]["value"] > 0
    # An average is an average, not a sum divided in the browser.
    assert metrics["average"]["value"] == pytest.approx(
        metrics["revenue"]["value"] / body["total"], rel=0.01
    )

    # Breakdowns are group-bys, largest first, and they add up to the total.
    status = next(item for item in body["breakdowns"] if item["field"] == "status")
    counts = [point["value"] for point in status["series"]]
    assert counts == sorted(counts, reverse=True)
    assert sum(counts) == body["total"]

    assert body["trend"]["measure"] == "total"
    assert len(body["trend"]["series"]) > 1


@pytest.mark.database
def test_insights_describe_the_filtered_rows_and_not_the_whole_table(client, monkeypatch):
    """The number above a list must be about the list, or it is a second answer."""
    headers = _authenticate(monkeypatch)

    everything = client.post(
        f"{PREFIX}/api/explorer/insights", headers=headers, json={"resource_type": "order"}
    ).get_json()
    portal = client.post(
        f"{PREFIX}/api/explorer/insights",
        headers=headers,
        json={"resource_type": "order", "filters": {"channel": "PORTAL"}},
    ).get_json()

    assert 0 < portal["total"] < everything["total"]
    assert portal["metrics"][1]["value"] < everything["metrics"][1]["value"]
    # And it agrees with the list the same filter produces.
    listed = client.post(
        f"{PREFIX}/api/explorer/query",
        headers=headers,
        json={"resource_type": "order", "filters": {"channel": "PORTAL"}, "page_size": 1},
    ).get_json()
    assert listed["total"] == portal["total"]


@pytest.mark.database
def test_a_share_metric_is_a_percentage_and_survives_an_empty_set(client, monkeypatch):
    headers = _authenticate(monkeypatch)

    tickets = client.post(
        f"{PREFIX}/api/explorer/insights", headers=headers, json={"resource_type": "ticket"}
    ).get_json()
    breached = next(item for item in tickets["metrics"] if item["key"] == "breached")
    assert 0 <= breached["value"] <= 100
    assert breached["format"] == "percent"

    # A share of nothing is zero, not a division by zero. The filter is chosen
    # to match no rows at all.
    empty = client.post(
        f"{PREFIX}/api/explorer/insights",
        headers=headers,
        json={"resource_type": "ticket", "query_text": "no-such-ticket-anywhere"},
    ).get_json()
    assert empty["total"] == 0
    assert all(metric["value"] == 0 for metric in empty["metrics"])


@pytest.mark.database
def test_a_breakdown_collapses_its_tail_rather_than_dropping_it(client, monkeypatch):
    """A chart whose slices do not add up cannot be reconciled with the list."""
    body = client.post(
        f"{PREFIX}/api/explorer/insights",
        headers=_authenticate(monkeypatch),
        json={"resource_type": "customer"},
    ).get_json()

    industry = next(item for item in body["breakdowns"] if item["field"] == "industry")
    assert sum(point["value"] for point in industry["series"]) == body["total"]
    if industry["distinct"] > 8:
        assert industry["series"][-1]["name"].endswith("others")


@pytest.mark.database
def test_every_dataset_declares_insights_and_refuses_an_unknown_one(client, monkeypatch):
    headers = _authenticate(monkeypatch)

    # Every dataset the catalogue offers can answer this, or an entity page
    # built on it opens with four empty boxes.
    for key in ("task", "ticket", "project", "customer", "order", "device"):
        body = client.post(
            f"{PREFIX}/api/explorer/insights", headers=headers, json={"resource_type": key}
        ).get_json()
        assert body["metrics"], key
        assert body["breakdowns"], key

    unknown = client.post(
        f"{PREFIX}/api/explorer/insights", headers=headers, json={"resource_type": "secrets"}
    )
    assert unknown.status_code == 400
    assert client.post(f"{PREFIX}/api/explorer/insights", json={}).status_code == 401


@pytest.mark.database
def test_the_connection_map_answers_before_a_record_is_chosen(client, monkeypatch):
    """The landing view of §50: how does any of this connect, in aggregate."""
    response = client.get(
        f"{PREFIX}/api/relationships/overview", headers=_authenticate(monkeypatch)
    )

    assert response.status_code == 200
    body = response.get_json()

    keys = {node["key"] for node in body["nodes"]}
    assert {"ticket", "customer", "order", "project"} <= keys
    assert all(node["count"] > 0 for node in body["nodes"])

    # Every edge is a foreign key that exists, in the direction it points.
    edge = next(
        item for item in body["edges"]
        if item["source"] == "order" and item["target"] == "customer"
    )
    assert edge["relation"] == "customer_id"
    assert edge["count"] > 0
    assert 0 < edge["coverage"] <= 100
    # Edges are ordered by weight, so the map's strongest links are first.
    counts = [item["count"] for item in body["edges"]]
    assert counts == sorted(counts, reverse=True)

    # Hubs are the records the most rows point at — the useful place to start.
    assert body["hubs"]
    assert all(hub["connections"] > 0 for hub in body["hubs"])
    assert body["totals"]["relations"] == len(body["edges"])


@pytest.mark.database
def test_the_connection_map_omits_datasets_the_caller_cannot_read(client, monkeypatch):
    # The map is drawn from what the reader may see, not from the schema —
    # otherwise it is a diagram of data they were refused.
    _authenticate(monkeypatch, "user", "viewer")
    monkeypatch.setattr("src.core.auth.users.permissions_for", lambda *_args: set())

    response = client.get(
        f"{PREFIX}/api/relationships/overview",
        headers={"Authorization": "Bearer verified-but-unprivileged"},
    )

    assert response.status_code == 403
    assert response.get_json()["details"]["missing"] == ["records.view"]


@pytest.mark.database
def test_relationships_are_derived_from_the_schema_not_a_second_list(client, monkeypatch):
    """Every group corresponds to a real foreign key, in the right direction."""
    from src.core.db import session_scope
    from src.models.business import Customer

    headers = _authenticate(monkeypatch)
    with session_scope() as session:
        # A *live* one, and ordered. `limit(1)` on its own returns whichever row
        # PostgreSQL reaches first, which moves whenever anything updates the
        # table — a `--sync-tags` run was enough — and eventually returns a
        # soft-deleted customer the endpoint correctly refuses. A test that
        # passes on incidental physical ordering is a test that fails for a
        # reason unrelated to what it asserts.
        customer = session.scalars(
            select(Customer)
            .where(Customer.deleted_at.is_(None))
            .order_by(Customer.created_at.asc())
            .limit(1)
        ).one()
        customer_id = str(customer.id)

    response = client.get(f"{PREFIX}/api/relationships/customer/{customer_id}", headers=headers)

    assert response.status_code == 200
    body = response.get_json()
    assert body["root"]["id"] == customer_id
    assert body["root"]["resource_type"] == "customer"

    outbound = {group["relation"] for group in body["groups"] if group["direction"] == "outbound"}
    inbound = {group["relation"] for group in body["groups"] if group["direction"] == "inbound"}
    # Declared on `customers` as columns…
    assert outbound <= {"account_manager_id", "organization_id", "region_id"}
    # …and on other tables as columns pointing back at it.
    assert inbound <= {
        "tickets.customer_id", "orders.customer_id", "projects.customer_id",
    }
    for group in body["groups"]:
        assert group["total"] >= len(group["items"])
        assert group["items"], "a group with no rows should not be returned at all"


@pytest.mark.database
def test_an_inbound_relation_is_counted_in_full_and_sampled(client, monkeypatch):
    from src.core.db import session_scope
    from src.models.business import Project, Task

    headers = _authenticate(monkeypatch)
    with session_scope() as session:
        project_id = session.scalars(
            # Live and ordered, for the reason above.
            select(Task.project_id)
            .where(Task.project_id.is_not(None), Task.deleted_at.is_(None))
            .order_by(Task.created_at.asc())
            .limit(1)
        ).one()
        expected = session.scalar(
            select(func.count()).select_from(Task).where(
                Task.project_id == project_id, Task.deleted_at.is_(None)
            )
        )
        assert session.get(Project, project_id) is not None

    response = client.get(
        f"{PREFIX}/api/relationships/project/{project_id}?sample=2", headers=headers
    )

    tasks = next(
        group for group in response.get_json()["groups"] if group["relation"] == "tasks.project_id"
    )
    assert tasks["total"] == expected
    assert len(tasks["items"]) == min(2, expected)
    assert tasks["has_more"] is (expected > 2)


@pytest.mark.database
def test_relationships_refuse_an_unknown_dataset_or_a_missing_record(client, monkeypatch):
    headers = _authenticate(monkeypatch)

    unknown = client.get(f"{PREFIX}/api/relationships/secrets/{uuid4()}", headers=headers)
    missing = client.get(f"{PREFIX}/api/relationships/task/{uuid4()}", headers=headers)

    assert unknown.status_code == 400
    assert missing.status_code == 404


def test_relationships_require_a_token(client):
    assert client.get(f"{PREFIX}/api/relationships/task/{uuid4()}").status_code == 401
