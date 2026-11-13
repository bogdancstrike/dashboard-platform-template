"""The tag vocabulary's rules: names, colours, categories, and how many one record may carry.

`test_tags` covers the main journeys. These pin each refusal the tag manager
and the record's tag picker rely on, renames that collide, and tagging a record
that does not exist.
"""

from __future__ import annotations

import uuid

import pytest

from src.services import tags as service
from tests.personas import PREFIX, as_each

TAGS = f"{PREFIX}/tags"

pytestmark = pytest.mark.database


@pytest.mark.parametrize(("body", "says"), [
    ({"name": "   "}, "needs a name"),
    ({"name": "!!!"}, "needs a name"),                       # nothing left to slug
    ({"name": "x" * (service.MAX_NAME + 1)}, "at most"),
    ({"name": "fine", "color": "#12345"}, "six-digit hex"),
    ({"name": "fine", "category": "VIBES"}, "not a tag category"),
    ({"name": "fine", "description": "d" * (service.MAX_DESCRIPTION + 1)}, "description is at most"),
])
def test_a_bad_tag_is_refused_with_its_reason(client, monkeypatch, body, says):
    admin = as_each(monkeypatch)("admin")
    response = client.post(TAGS, json=body, headers=admin)
    assert response.status_code == 400, response.get_json()
    assert says.lower() in response.get_json()["message"].lower()


def test_a_tag_is_edited_in_part_and_a_rename_cannot_take_anothers_name(client, monkeypatch):
    admin = as_each(monkeypatch)("admin")
    first = client.post(TAGS, json={"name": f"cov-a-{uuid.uuid4().hex[:5]}"}, headers=admin).get_json()
    second = client.post(TAGS, json={"name": f"cov-b-{uuid.uuid4().hex[:5]}", "color": "#ABCDEF",
                                     "category": "region", "description": "  somewhere  "},
                         headers=admin).get_json()
    assert second["color"] == "#abcdef" and second["category"] == "REGION" and second["description"] == "somewhere"

    clash = client.put(f"{TAGS}/{second['id']}", json={"name": first["name"]}, headers=admin)
    assert clash.status_code == 409 and "already uses" in clash.get_json()["message"]
    edited = client.put(f"{TAGS}/{second['id']}", json={"description": "", "category": "status", "color": ""},
                        headers=admin)
    assert edited.status_code == 200, edited.get_json()
    assert edited.get_json()["description"] in (None, "") and edited.get_json()["color"] == "#64748b"
    assert client.put(f"{TAGS}/{uuid.uuid4()}", json={"color": "#000000"}, headers=admin).status_code == 404
    assert client.put(f"{TAGS}/{second['id']}", json="red", headers=admin).status_code == 400


def test_a_record_carries_a_bounded_list_of_real_tags(client, monkeypatch):
    admin = as_each(monkeypatch)("admin")
    made = client.post(f"{PREFIX}/api/records/task", json={"title": "Tag probe"}, headers=admin)
    assert made.status_code == 201
    url = f"{PREFIX}/api/records/task/{made.get_json()['id']}/tags"
    assert client.put(url, json={"tags": "urgent"}, headers=admin).status_code == 400
    too_many = [f"cov-many-{i}" for i in range(service.MAX_PER_RECORD + 1)]
    response = client.put(url, json={"tags": too_many}, headers=admin)
    assert response.status_code == 400 and "more than" in response.get_json()["message"]
    missing = client.put(f"{PREFIX}/api/records/task/{uuid.uuid4()}/tags", json={"tags": []}, headers=admin)
    assert missing.status_code == 404
