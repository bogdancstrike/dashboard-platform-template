"""Data Explorer HTTP contract: auth, SQL queries and saved visibility. — global search (§32)."""

from __future__ import annotations

import pytest

from tests.explorer_support import (  # noqa: F401
    PREFIX,
    _authenticate,
)


@pytest.mark.database
def test_global_search_ranks_an_exact_reference_above_a_mention(client, monkeypatch):
    """The whole point of scoring: the record *called* TSK-00042 comes first."""
    response = client.get(
        f"{PREFIX}/api/search/global?q=TSK-00042", headers=_authenticate(monkeypatch)
    )

    assert response.status_code == 200
    body = response.get_json()
    assert body["query"] == "TSK-00042"
    tasks = next(group for group in body["groups"] if group["resource_type"] == "task")
    first = tasks["items"][0]
    assert first["label"] == "TSK-00042"
    assert first["matched_field"] == "reference"
    # Exact beats prefix beats contains; see EXACT/PREFIX/CONTAINS.
    assert first["score"] >= 100
    assert all(first["score"] >= item["score"] for item in tasks["items"])


@pytest.mark.database
def test_a_search_group_says_where_its_dataset_lives(client, monkeypatch):
    """So a caller can offer the record's own page (§31).

    The declaration carries the path and the explorer catalogue publishes it; a
    search hit that did not was the one place a caller had to guess, and the
    guess was `/explore?resource=…&f.id=…` — a query string that selects the
    record rather than the page that *is* it.
    """
    response = client.get(
        f"{PREFIX}/api/search/global?q=TSK-00042", headers=_authenticate(monkeypatch)
    )

    groups = {group["resource_type"]: group for group in response.get_json()["groups"]}
    assert groups["task"]["path"] == "/tasks"
    # Every group, not only the one this term happened to hit hardest.
    assert all(group["path"].startswith("/") for group in groups.values())


@pytest.mark.database
def test_global_search_says_which_field_matched_and_shows_it(client, monkeypatch):
    response = client.get(
        f"{PREFIX}/api/search/global?q=migration", headers=_authenticate(monkeypatch)
    )

    body = response.get_json()
    assert body["total"] > 0
    for group in body["groups"]:
        for item in group["items"]:
            assert item["matched_field"]
            assert item["matched_label"]
            # The snippet contains the term it was cut around.
            assert "migration" in item["snippet"].lower()


@pytest.mark.database
def test_global_search_asks_for_a_term_rather_than_failing(client, monkeypatch):
    """An empty box is the normal state of a search page, not a bad request."""
    headers = _authenticate(monkeypatch)

    empty = client.get(f"{PREFIX}/api/search/global", headers=headers)
    single = client.get(f"{PREFIX}/api/search/global?q=a", headers=headers)

    assert empty.status_code == 200
    assert empty.get_json() == {"query": "", "total": 0, "groups": [], "truncated": False}
    assert single.status_code == 200
    assert single.get_json()["total"] == 0


@pytest.mark.database
def test_global_search_only_looks_where_the_caller_may_read(client, monkeypatch):
    """A dataset the role cannot read is not searched, not searched and hidden."""
    from src.services.records.explorer import resources

    everything = client.get(
        f"{PREFIX}/api/search/global?q=e", headers=_authenticate(monkeypatch)
    )
    searched = client.get(
        f"{PREFIX}/api/search/global?q=re", headers=_authenticate(monkeypatch)
    ).get_json()

    assert everything.status_code == 200
    assert {group["resource_type"] for group in searched["groups"]} <= set(resources())


def test_global_search_requires_a_token(client):
    assert client.get(f"{PREFIX}/api/search/global?q=abc").status_code == 401


@pytest.mark.database
def test_the_catalogue_describes_exactly_the_fields_the_explorer_exposes(client, monkeypatch):
    """Generated from one declaration, so it cannot describe a field that is
    not there or omit one that is — which is how a hand-kept catalogue rots."""
    from src.services.records.explorer import resources

    response = client.get(f"{PREFIX}/api/catalog/datasets", headers=_authenticate(monkeypatch))

    assert response.status_code == 200
    body = response.get_json()
    assert body["total"] == len(resources())
    for entry in body["items"]:
        declared = resources()[entry["key"]].fields
        assert [field["name"] for field in entry["fields"]] == [
            spec.name for spec in declared.fields
        ]


@pytest.mark.database
def test_completeness_is_measured_against_the_whole_dataset(client, monkeypatch):
    response = client.get(f"{PREFIX}/api/catalog/datasets", headers=_authenticate(monkeypatch))

    tasks = next(item for item in response.get_json()["items"] if item["key"] == "task")
    assert tasks["record_count"] > 0
    reference = next(field for field in tasks["fields"] if field["name"] == "reference")
    description = next(field for field in tasks["fields"] if field["name"] == "description")

    # A required column is complete; an optional one is not, and the count it
    # was derived from is returned beside the percentage.
    assert reference["completeness"] == 100.0
    assert reference["filled"] == tasks["record_count"]
    assert 0 < description["completeness"] < 100
    assert description["filled"] < tasks["record_count"]


@pytest.mark.database
def test_the_catalogue_reports_the_values_a_field_actually_holds(client, monkeypatch):
    """The declared choices are what the code allows; this is what the data has."""
    response = client.get(
        f"{PREFIX}/api/catalog/datasets/task?field=status", headers=_authenticate(monkeypatch)
    )

    body = response.get_json()
    assert body["field"] == "status"
    counts = [entry["count"] for entry in body["values"]]
    assert counts == sorted(counts, reverse=True)
    from src.core import vocabulary

    assert {entry["value"] for entry in body["values"]} <= set(vocabulary.TASK_STATUS)


@pytest.mark.database
def test_the_catalogue_refuses_an_unknown_dataset_or_field(client, monkeypatch):
    headers = _authenticate(monkeypatch)

    dataset = client.get(f"{PREFIX}/api/catalog/datasets/secrets", headers=headers)
    field = client.get(f"{PREFIX}/api/catalog/datasets/task?field=nope", headers=headers)

    assert dataset.status_code == 400
    assert "task" in dataset.get_json()["details"]["available"]
    assert field.status_code == 400
    assert "status" in field.get_json()["details"]["available"]


def test_the_catalogue_requires_a_token(client):
    assert client.get(f"{PREFIX}/api/catalog/datasets").status_code == 401


@pytest.mark.database
def test_facets_are_computed_only_when_they_are_asked_for(client, monkeypatch):
    """A GROUP BY per faceted column is work somebody waits for, and the
    explorer filters through the condition builder rather than a facet row."""
    headers = _authenticate(monkeypatch)
    body = {"resource_type": "task", "columns": ["reference"], "page_size": 5}

    default = client.post(f"{PREFIX}/api/explorer/query", headers=headers, json=body)
    asked = client.post(
        f"{PREFIX}/api/explorer/query", headers=headers, json={**body, "facets": True}
    )

    assert default.get_json()["facets"] == {}
    facets = asked.get_json()["facets"]
    assert set(facets) == {"status", "priority", "kind"}
    assert facets["status"], "a faceted column with rows must offer values"
