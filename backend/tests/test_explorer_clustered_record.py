"""Data Explorer HTTP contract: auth, SQL queries and saved visibility. — the clustered record network (§50)."""

from __future__ import annotations

import pytest

from tests.explorer_support import (  # noqa: F401
    PREFIX,
    _authenticate,
    created_searches,
    preserved_defaults,
)


@pytest.mark.database
def test_the_network_returns_a_clustered_slice_of_the_real_record_graph(client, monkeypatch):
    """§50's analysis view: not one record's neighbours, but the structure."""
    response = client.get(
        f"{PREFIX}/api/relationships/network?focus=customer", headers=_authenticate(monkeypatch)
    )

    assert response.status_code == 200
    body = response.get_json()

    keys = {node["key"] for node in body["nodes"]}
    assert len(keys) == len(body["nodes"]), "a node appeared twice"
    assert body["stats"]["nodes"] == len(body["nodes"])

    # Every edge has both ends on screen. An edge to a node that was cut for
    # the node budget would draw a line to nothing.
    assert all(edge["source"] in keys and edge["target"] in keys for edge in body["edges"])

    # More than one entity type, or it is a list rather than a network.
    assert len({node["entity"] for node in body["nodes"]}) > 1

    # Every node carries the two things the picture is drawn from.
    assert all(node["community"] for node in body["nodes"])
    assert all(node["degree"] >= 0 for node in body["nodes"])

    # The clustering is real structure rather than an arbitrary cut.
    assert body["stats"]["communities"] > 1
    assert body["stats"]["modularity"] > 0.3


@pytest.mark.database
def test_every_community_is_described_well_enough_to_read_without_the_picture(
    client, monkeypatch
):
    """§55: a coloured blob is not a finding, and not everybody sees colour."""
    body = client.get(
        f"{PREFIX}/api/relationships/network?focus=customer",
        headers=_authenticate(monkeypatch),
    ).get_json()

    assert body["communities"]
    sizes = [community["size"] for community in body["communities"]]
    assert sizes == sorted(sizes, reverse=True), "largest cluster first"

    community = body["communities"][0]
    assert community["label"], "a cluster has to be callable by a name"
    assert community["members"], "and has to say who is in it"
    assert sum(item["count"] for item in community["mix"]) == community["size"]
    # Membership matches the nodes, so the summary cannot drift from the graph.
    in_community = [node for node in body["nodes"] if node["community"] == community["id"]]
    assert len(in_community) == community["size"]


@pytest.mark.database
def test_the_network_is_the_same_answer_twice(client, monkeypatch):
    """Clustered on the server precisely so two viewers see one picture."""
    headers = _authenticate(monkeypatch)
    url = f"{PREFIX}/api/relationships/network?focus=project&anchors=6"

    first = client.get(url, headers=headers).get_json()
    second = client.get(url, headers=headers).get_json()

    assert {node["key"]: node["community"] for node in first["nodes"]} == {
        node["key"]: node["community"] for node in second["nodes"]
    }
    assert first["stats"] == second["stats"]


@pytest.mark.database
def test_the_network_can_be_built_around_an_entity_nothing_points_at(client, monkeypatch):
    """Devices are pointed at by nothing, so recency would give N islands.

    They still cluster — around the project and the region behind them — and
    that fallback is worth asserting because its absence is invisible: the
    endpoint answers 200 with a picture that simply has no structure in it.
    """
    body = client.get(
        f"{PREFIX}/api/relationships/network?focus=device", headers=_authenticate(monkeypatch)
    ).get_json()

    assert body["nodes"], "a dataset with rows must produce a network"
    assert body["stats"]["communities"] > 1
    assert body["stats"]["edges"] > 0


@pytest.mark.database
def test_the_network_refuses_an_unknown_dataset_and_needs_a_token(client, monkeypatch):
    unknown = client.get(
        f"{PREFIX}/api/relationships/network?focus=secrets", headers=_authenticate(monkeypatch)
    )

    assert unknown.status_code == 400
    assert "available" in unknown.get_json()["details"]
    assert client.get(f"{PREFIX}/api/relationships/network").status_code == 401


@pytest.mark.database
def test_paging_over_a_column_full_of_ties_never_repeats_or_skips_a_row(client, monkeypatch):
    """The seed writes every task in one transaction, so `updated_at` is the
    same for all of them — an ordering with no tiebreaker is then free to
    return a different sequence per query, and OFFSET paging over it shows one
    row twice and another never."""
    headers = _authenticate(monkeypatch)
    body = {
        "resource_type": "task", "columns": ["reference"],
        "sort": "updated_at", "order": "desc", "page_size": 25,
    }

    pages = [
        client.post(
            f"{PREFIX}/api/explorer/query", headers=headers, json={**body, "page": page}
        ).get_json()
        for page in (1, 2)
    ]
    seen = [item["id"] for page in pages for item in page["items"]]

    assert len(seen) == len(set(seen)), "a row appeared on two pages"
    # And asking again gives the same answer, not a reshuffle.
    again = client.post(
        f"{PREFIX}/api/explorer/query", headers=headers, json={**body, "page": 1}
    ).get_json()
    assert [item["id"] for item in again["items"]] == [item["id"] for item in pages[0]["items"]]
