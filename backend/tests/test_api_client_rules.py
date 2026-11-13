"""Editing an API client: each refusal, and an audit sentence that says what moved.

`test_api_clients` covers creation, rotation and revocation. These pin the
edit form's rules — names, scopes as a list, statuses, numeric limits in their
ranges — and that the audit message names a scope added or removed and a status
change, which is what a security review looks for.
"""

from __future__ import annotations

import uuid

import pytest

from src.services import api_clients as service
from tests.personas import PREFIX, as_each

CLIENTS = f"{PREFIX}/admin/api-clients"
CREDENTIALS = f"{PREFIX}/admin/api-credentials"

pytestmark = pytest.mark.database


def test_an_edit_is_checked_field_by_field(client, monkeypatch):
    admin = as_each(monkeypatch)("admin")
    made = client.post(CLIENTS, json={"name": f"Rules probe {uuid.uuid4().hex[:6]}",
                                      "allowed_ips": [None, "10.0.0.2"]}, headers=admin)
    assert made.status_code == 201, made.get_json()
    client_id = (made.get_json().get("client") or made.get_json())["id"]
    # A JSON null is "no address", not the address "None" (it was stored as one).
    assert (made.get_json().get("client") or made.get_json())["allowed_ips"] == ["10.0.0.2"]
    url = f"{CLIENTS}/{client_id}"

    for bad in ({"name": "!"}, {"scopes": "records.view"}, {"status": "ASLEEP"},
                {"rate_limit_per_minute": "fast"}, {"rate_limit_per_minute": 0},
                {"quota_per_day": 10**12}):
        response = client.put(url, json=bad, headers=admin)
        assert response.status_code == 400, (bad, response.get_json())

    edited = client.put(url, json={"description": "  ", "allowed_ips": ["10.0.0.1", " ", None],
                                   "rate_limit_per_minute": None, "scopes": ["records.view"],
                                   "status": "suspended"}, headers=admin)
    assert edited.status_code == 200, edited.get_json()
    body = edited.get_json()
    assert body.get("description") in (None, "") and body["allowed_ips"] == ["10.0.0.1"]
    assert body["status"] == "SUSPENDED"
    assert client.put(f"{CLIENTS}/{uuid.uuid4()}", json={"name": "Valid name"}, headers=admin).status_code == 404
    assert client.delete(f"{CREDENTIALS}/{uuid.uuid4()}", headers=admin).status_code == 404


def test_the_audit_sentence_names_what_moved():
    before = {"scopes": ["a.view", "b.view"], "status": "ACTIVE"}
    after = {"scopes": ["b.view", "c.view"], "status": "SUSPENDED"}
    assert service._change_sentence("Feed", before, after) == "edited Feed (+c.view; -a.view; active → suspended)"
    assert service._change_sentence("Feed", before, before) == "edited Feed"


def test_a_limit_is_a_whole_number_in_range():
    from src.core.errors import ValidationError

    assert service._bounded(None, 7, 1, 10) == 7 and service._bounded("3", 7, 1, 10) == 3
    for bad in ("x", 0, 11):
        with pytest.raises(ValidationError):
            service._bounded(bad, 7, 1, 10)
