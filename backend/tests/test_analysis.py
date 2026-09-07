"""Grouped analysis (§2, §28, §44, §71).

One compiler serves the analytics workspace, both builders and the map, so
what is asserted here is the contract they all depend on: that it groups and
measures in SQL, that it refuses anything the declaration does not publish,
that a period means one thing, and that a chart drawn from its rows can be
reconciled with the totals beside them.
"""

from __future__ import annotations

import pytest

from src.config import Config
from tests.conftest import persona_claims

PREFIX = Config.API_PREFIX
RUN = f"{PREFIX}/api/analysis/run"


def _authenticate(monkeypatch, username: str = "admin", role: str = "administrator"):
    monkeypatch.setattr(
        "src.core.auth.verify_token",
        lambda _token: persona_claims(username, role, sid=f"analysis-{username}"),
    )
    return {"Authorization": f"Bearer analysis-{username}"}


def test_analysis_needs_a_bearer_token(client):
    assert client.post(RUN, json={"resource_type": "order"}).status_code == 401
    assert client.get(f"{PREFIX}/api/analysis/catalog").status_code == 401


def test_a_period_name_resolves_to_one_window():
    from src.services.analysis import period_window

    # Resolved on the server so a tile, the chart beneath it and the list it
    # drills into cannot each decide what "last 30 days" means (§44).
    window = period_window("last_30_days")
    assert window.start is not None and window.end is not None
    assert 29 <= (window.end - window.start).days <= 30
    assert period_window("all_time").start is None


def test_an_unknown_period_is_refused_with_the_ones_that_exist():
    from src.core.errors import ValidationError
    from src.services.analysis import period_window

    with pytest.raises(ValidationError) as raised:
        period_window("since_tuesday")
    assert "last_30_days" in raised.value.details["allowed"]


@pytest.mark.database
def test_the_catalogue_offers_only_what_the_declaration_publishes(client, monkeypatch):
    from src.services.explorer import resources

    body = client.get(
        f"{PREFIX}/api/analysis/catalog", headers=_authenticate(monkeypatch)
    ).get_json()

    orders = next(item for item in body["datasets"] if item["key"] == "order")
    declared = resources()["order"].fields
    # Every dimension and measure is a declared field, so the builder cannot
    # offer a column the compiler will reject.
    assert {item["name"] for item in orders["dimensions"]} <= set(declared.by_name)
    assert {item["name"] for item in orders["measures"]} <= set(declared.by_name)
    # And only numbers can be measured.
    assert all(declared.by_name[item["name"]].kind == "number" for item in orders["measures"])
    # The date a period means for orders is when they were placed, not when
    # somebody last edited them.
    assert orders["default_date"] == "placed_at"


@pytest.mark.database
def test_it_groups_and_measures_in_sql_rather_than_over_a_page(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    body = client.post(
        RUN,
        json={
            "resource_type": "order",
            "dimensions": ["status"],
            "measures": [{"aggregation": "sum", "field": "total"}, {"aggregation": "count"}],
        },
        headers=headers,
    ).get_json()

    # Measured against what one page of the list actually returns rather than
    # against a constant: the seed ships at two scales, and a test that only
    # holds on the larger one is a test that fails for the reason it was never
    # about (§57).
    page = client.post(
        f"{PREFIX}/api/explorer/query",
        json={"resource_type": "order", "page_size": 10},
        headers=headers,
    ).get_json()
    assert body["matched"] == page["total"] > page["page_size"]
    # The parts reconcile with the whole: the rows plus the collapsed tail add
    # up to the total the server computed separately.
    drawn = sum(row["values"]["count"] for row in body["rows"])
    tail = (body["other"] or {}).get("values", {}).get("count", 0) or 0
    assert drawn + tail == body["totals"]["count"] == body["matched"]


@pytest.mark.database
def test_a_date_dimension_is_bucketed_and_reads_in_order(client, monkeypatch):
    body = client.post(
        RUN,
        json={
            "resource_type": "order",
            "dimensions": [{"field": "placed_at", "granularity": "month"}],
            "measures": [{"aggregation": "sum", "field": "total"}],
            "period": "last_365_days",
        },
        headers=_authenticate(monkeypatch),
    ).get_json()

    buckets = [row["keys"][0] for row in body["rows"]]
    assert buckets == sorted(buckets)
    # A time series is not a top-N: its tail is not folded into "Other",
    # because the missing rows would be a hole in the line.
    assert body["other"] is None
    assert body["dimensions"][0]["granularity"] == "month"


@pytest.mark.database
def test_a_period_narrows_the_rows_it_measures(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    payload = {"resource_type": "order", "measures": [{"aggregation": "count"}]}

    everything = client.post(RUN, json=payload, headers=headers).get_json()
    recent = client.post(
        RUN, json={**payload, "period": "last_30_days"}, headers=headers
    ).get_json()

    assert recent["matched"] < everything["matched"]
    assert recent["period"]["field"] == "placed_at"


@pytest.mark.database
def test_a_filter_applies_to_the_analysis_and_not_only_to_the_list(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    everything = client.post(
        RUN, json={"resource_type": "ticket"}, headers=headers
    ).get_json()
    critical = client.post(
        RUN, json={"resource_type": "ticket", "filters": {"severity": "CRITICAL"}},
        headers=headers,
    ).get_json()

    assert 0 < critical["matched"] < everything["matched"]


@pytest.mark.database
def test_a_column_the_declaration_does_not_publish_cannot_be_grouped_by(client, monkeypatch):
    response = client.post(
        RUN,
        json={"resource_type": "order", "dimensions": ["customer_id"]},
        headers=_authenticate(monkeypatch),
    )

    # A UUID groups into one row per record, which is a list rather than an
    # analysis — and the refusal names what can be grouped by instead.
    assert response.status_code == 400
    assert "status" in response.get_json()["details"]["available"]


@pytest.mark.database
def test_a_text_column_cannot_be_summed(client, monkeypatch):
    response = client.post(
        RUN,
        json={"resource_type": "order", "measures": [{"aggregation": "sum", "field": "reference"}]},
        headers=_authenticate(monkeypatch),
    )

    assert response.status_code == 400
    assert "total" in response.get_json()["details"]["available"]


@pytest.mark.database
def test_three_dimensions_are_refused_because_no_chart_draws_them(client, monkeypatch):
    response = client.post(
        RUN,
        json={"resource_type": "ticket", "dimensions": ["status", "severity", "channel"]},
        headers=_authenticate(monkeypatch),
    )

    assert response.status_code == 400


@pytest.mark.database
def test_the_description_names_the_query_that_ran(client, monkeypatch):
    body = client.post(
        RUN,
        json={
            "resource_type": "customer",
            "dimensions": ["segment"],
            "measures": [{"aggregation": "sum", "field": "lifetime_value"}],
            "period": "last_90_days",
        },
        headers=_authenticate(monkeypatch),
    ).get_json()

    # Written from the same objects the SQL was built from, so a panel heading
    # cannot describe a different query than the one that ran (§51).
    assert "lifetime value" in body["description"]
    assert "segment" in body["description"]
    assert "90" in body["description"]


@pytest.mark.database
def test_an_average_has_no_remainder_because_averages_do_not_decompose(client, monkeypatch):
    body = client.post(
        RUN,
        json={
            "resource_type": "customer",
            "dimensions": ["country"],
            "measures": [{"aggregation": "avg", "field": "satisfaction"}],
            "limit": 3,
        },
        headers=_authenticate(monkeypatch),
    ).get_json()

    assert body["truncated"] is True
    # A "remaining average" obtained by subtraction is a number that looks
    # right and is not, so it is reported as absent instead.
    assert body["other"]["values"]["avg:satisfaction"] is None


@pytest.mark.database
def test_analysis_requires_the_permission_the_dataset_declares(client, monkeypatch):
    _authenticate(monkeypatch, "user", "viewer")
    monkeypatch.setattr("src.core.auth._permissions_for", lambda *_args: set())

    response = client.post(
        RUN, json={"resource_type": "order"},
        headers={"Authorization": "Bearer verified-but-unprivileged"},
    )

    assert response.status_code == 403
    assert response.get_json()["details"]["missing"] == ["records.view"]
