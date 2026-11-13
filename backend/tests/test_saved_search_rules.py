"""A saved search's definition is checked field by field, and an edit means only what it says.

`test_explorer` covers saving, sharing and running. These pin each refusal the
save dialog can meet and a partial edit leaving the rest of the view alone.
"""

from __future__ import annotations

import pytest

from tests.personas import PREFIX, as_each

SEARCHES = f"{PREFIX}/api/saved-searches"

pytestmark = pytest.mark.database


def _search(**fields):
    return {"name": "Rules probe", "resource_type": "task", **fields}


@pytest.mark.parametrize(("body", "says"), [
    (_search(colour="red"), "Unknown saved-search field"),
    (_search(name=" "), "1 to 200"),
    (_search(condition_tree="status = OPEN"), "condition_tree"),
    (_search(filters=["status"]), "filters must be an object"),
    (_search(query_text="q" * 501), "at most 500"),
    (_search(sort="no_such_field"), "sort is not available"),
    (_search(order="sideways"), "asc or desc"),
    (_search(columns=[]), "non-empty array"),
    (_search(columns=["no_such_column"]), "Unknown result column"),
    (_search(page_size="lots"), "page_size must be an integer"),
    (_search(page_size=7), "page_size must be"),
    (_search(view_mode="hologram"), "view_mode"),
])
def test_a_bad_view_is_refused_with_its_reason(client, monkeypatch, body, says):
    admin = as_each(monkeypatch)("admin")
    response = client.post(SEARCHES, json=body, headers=admin)
    assert response.status_code == 400, response.get_json()
    assert says.lower() in response.get_json()["message"].lower()


def test_a_partial_edit_changes_only_what_it_names(client, monkeypatch):
    admin = as_each(monkeypatch)("admin")
    made = client.post(SEARCHES, json=_search(description="  two   words ", columns=["title", "title", "status"],
                                              query_text="  x  "), headers=admin)
    assert made.status_code == 201, made.get_json()
    search = made.get_json()
    assert search["description"] == "two words" and search["columns"] == ["title", "status"]
    assert search["query_text"] == "x"

    edited = client.put(f"{SEARCHES}/{search['id']}", json={"page_size": 50, "description": ""}, headers=admin)
    assert edited.status_code == 200, edited.get_json()
    after = edited.get_json()
    assert after["page_size"] == 50 and after["description"] is None
    assert after["columns"] == ["title", "status"] and after["name"] == "Rules probe"
    assert client.put(f"{SEARCHES}/{search['id']}", json=["x"], headers=admin).status_code == 400
    transfer = client.post(f"{SEARCHES}/{search['id']}/transfer", json="nobody", headers=admin)
    assert transfer.status_code == 400
