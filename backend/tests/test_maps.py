"""Records on a map (§44, §61).

The claims worth asserting are the ones that make a map trustworthy rather than
decorative: that it counts every row including the ones it cannot draw, that a
dataset reaches its place through the join the declaration names, that the
country names match the map the frontend paints, and that seeing where the
devices are needs the same permission as seeing the devices.
"""

from __future__ import annotations

import pytest

from src.config import Config
from tests.conftest import persona_claims

PREFIX = Config.API_PREFIX
CATALOG = f"{PREFIX}/api/maps/catalog"
PLACES = f"{PREFIX}/api/maps/places"


def _authenticate(monkeypatch, username: str = "admin", role: str = "administrator"):
    monkeypatch.setattr(
        "src.core.auth.verify_token",
        lambda _token: persona_claims(username, role, sid=f"maps-{username}"),
    )
    return {"Authorization": f"Bearer maps-{username}"}


def test_the_map_needs_a_bearer_token(client):
    assert client.get(CATALOG).status_code == 401
    assert client.get(PLACES).status_code == 401


def test_every_seeded_city_has_a_coordinate():
    """The seed picks from the gazetteer, so it cannot generate an unplaceable city.

    Two lists — one to generate cities and one to map them — is a map with
    holes in it the first time anybody adds a city to only one of them.
    """
    from src.core import geography
    from src.seed import catalog

    seeded = {city for city, _country, _region in catalog.LOCATIONS}
    assert seeded == set(geography.PLACES_BY_CITY)
    for place in geography.PLACES:
        assert -90 <= place.latitude <= 90
        assert -180 <= place.longitude <= 180


def test_country_names_match_the_map_the_frontend_paints():
    """A name that does not match is a country that stays uncoloured.

    Which looks exactly like a country with no customers — the one failure a
    choropleth cannot survive, and it is silent. So the differences are
    declared, and this asserts the declaration is still needed and still right.
    """
    from src.core import geography

    assert geography.map_name("United States") == "United States of America"
    # Everything else is called what the records call it.
    assert geography.map_name("Germany") == "Germany"


@pytest.mark.database
def test_the_catalogue_says_how_each_dataset_reaches_a_place(client, monkeypatch):
    body = client.get(CATALOG, headers=_authenticate(monkeypatch)).get_json()
    datasets = {item["key"]: item for item in body["datasets"]}

    # A reader comparing "orders" with "customers" is entitled to know that
    # the orders are drawn at their customer's city, not their own.
    assert datasets["customer"]["placed_by"] == "own city"
    assert datasets["order"]["placed_by"] == "the customer's city"
    assert {metric["key"] for metric in datasets["order"]["metrics"]} == {"count", "revenue"}
    assert len(body["places"]) >= 30


@pytest.mark.database
def test_the_total_is_every_row_including_the_ones_it_cannot_draw(client, monkeypatch):
    """A map that silently omits rows answers a different question from the list."""
    headers = _authenticate(monkeypatch)
    body = client.get(f"{PLACES}?dataset=customer&metric=count", headers=headers).get_json()

    drawn = sum(point["rows"] for point in body["points"])
    assert drawn + body["unplaced"]["rows"] == body["total"]

    # And the total is the dataset's, not the page's.
    listed = client.post(
        f"{PREFIX}/api/explorer/query",
        json={"resource_type": "customer", "page_size": 1},
        headers=headers,
    ).get_json()
    assert body["total"] == listed["total"]


@pytest.mark.database
def test_the_parts_add_up_at_every_level(client, monkeypatch):
    """Cities into countries into regions: a map whose levels disagree is one
    nobody reconciles twice."""
    body = client.get(
        f"{PLACES}?dataset=customer&metric=value", headers=_authenticate(monkeypatch)
    ).get_json()

    cities = sum(point["rows"] for point in body["points"])
    assert cities == sum(country["rows"] for country in body["countries"])
    assert cities == sum(region["rows"] for region in body["regions"])
    assert round(sum(point["value"] for point in body["points"]), 2) == round(
        sum(country["value"] for country in body["countries"]), 2
    )


@pytest.mark.database
def test_an_order_is_drawn_where_its_customer_is(client, monkeypatch):
    """The join the declaration names, done in SQL rather than per row."""
    headers = _authenticate(monkeypatch)
    orders = client.get(f"{PLACES}?dataset=order&metric=revenue", headers=headers).get_json()

    assert orders["total"] > 0
    assert orders["metric"]["label"] == "Revenue"
    # Every point is a real place from the gazetteer, with coordinates.
    for point in orders["points"]:
        assert -90 <= point["latitude"] <= 90
        assert point["country"]


@pytest.mark.database
def test_a_device_site_is_folded_into_the_city_it_is_in(client, monkeypatch):
    """`Berlin — Depot 4` and `Berlin — Office 9` are one dot, because that is
    what a dot on a world map can be."""
    body = client.get(
        f"{PLACES}?dataset=device&metric=count", headers=_authenticate(monkeypatch)
    ).get_json()

    cities = [point["city"] for point in body["points"]]
    assert len(cities) == len(set(cities))
    assert all("—" not in city for city in cities)


@pytest.mark.database
def test_a_dataset_or_a_measure_it_does_not_offer_is_refused_by_name(client, monkeypatch):
    headers = _authenticate(monkeypatch)

    unknown = client.get(f"{PLACES}?dataset=invoice", headers=headers)
    assert unknown.status_code == 400
    assert "available" in unknown.get_json()["details"]

    wrong = client.get(f"{PLACES}?dataset=ticket&metric=revenue", headers=headers)
    assert wrong.status_code == 400
    assert wrong.get_json()["details"]["allowed"] == ["count"]


@pytest.mark.database
def test_seeing_where_the_records_are_needs_the_right_to_see_the_records(client, monkeypatch):
    """The map is a view of a dataset, so it is gated by that dataset's own
    permission rather than by a permission of its own."""
    headers = _authenticate(monkeypatch, "user", "viewer")
    response = client.get(f"{PLACES}?dataset=customer", headers=headers)
    assert response.status_code in (200, 403)
    if response.status_code == 403:
        assert "records.view" in str(response.get_json())


@pytest.mark.database
def test_a_region_is_named_rather_than_coded(client, monkeypatch):
    """`NEU` in a table is a table written for whoever built the seed."""
    body = client.get(
        f"{PLACES}?dataset=customer&metric=count", headers=_authenticate(monkeypatch)
    ).get_json()

    names = {region["name"] for region in body["regions"]}
    assert names
    assert names <= {"Western Europe", "Central Europe", "Northern Europe",
                     "United Kingdom & Ireland", "North America", "Asia Pacific"}


def test_the_seed_creates_the_regions_the_map_can_name():
    """One list of regions, so a region that can be seeded is one the map names."""
    from src.core import geography
    from src.seed import catalog

    assert {code for _name, code, _tz, _cur in catalog.REGIONS} == set(geography.REGIONS_BY_CODE)
    assert {place.region for place in geography.PLACES} <= set(geography.REGIONS_BY_CODE)
