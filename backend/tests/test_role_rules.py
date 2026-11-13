"""The roles matrix: what an administrator may change, and what protects them from themselves.

`test_roles` covers listing and the happy edits. These pin the refusals on a
role of an installation's own — code and name rules, built-in codes, a
duplicate — the edits that change nothing, the self-lockout guard, and that a
built-in role, or the one you are signed in with, cannot be deleted.
"""

from __future__ import annotations

import uuid

import pytest

from src.services.people import roles as service
from tests.personas import PREFIX, as_each

ROLES = f"{PREFIX}/admin/roles"

pytestmark = pytest.mark.database


def test_a_role_of_our_own_is_checked_edited_and_removed(client, monkeypatch):
    admin = as_each(monkeypatch)("admin")
    code = f"COV_{uuid.uuid4().hex[:6].upper()}"
    for bad, status in (({}, 400), ({"code": "x"}, 400), ({"code": "MANAGER", "name": "M"}, 409),
                        ({"code": code, "name": " "}, 400),
                        ({"code": code, "name": "n" * (service.MAX_NAME + 1)}, 400)):
        response = client.post(ROLES, json=bad, headers=admin)
        assert response.status_code == status, (bad, response.get_json())
    assert client.post(ROLES, json=["x"], headers=admin).status_code == 400

    made = client.post(ROLES, json={"code": code.lower(), "name": "Coverage role", "is_system": True,
                                    "permissions": ["records.view"]}, headers=admin)
    assert made.status_code == 201, made.get_json()
    assert made.get_json()["is_system"] is False  # a request cannot opt out of the protection
    assert client.post(ROLES, json={"code": code, "name": "Again"}, headers=admin).status_code == 409

    def put(**body):
        return client.put(f"{ROLES}/{code}", json=body, headers=admin)

    assert put(name="Coverage role", description="", permissions=["records.view"]).status_code == 200  # no change
    renamed = put(name="Coverage role 2", description="  For tests  ")
    assert renamed.status_code == 200 and renamed.get_json()["name"] == "Coverage role 2"
    for bad in ({"name": ""}, {"name": "n" * (service.MAX_NAME + 1)}):
        assert put(**bad).status_code == 400, bad
    assert client.put(f"{ROLES}/{code}", json=["x"], headers=admin).status_code == 400
    assert client.put(f"{ROLES}/NO_SUCH_ROLE", json={"name": "x"}, headers=admin).status_code == 404

    assert client.delete(f"{ROLES}/{code}", headers=admin).status_code == 200
    assert client.delete(f"{ROLES}/{code}", headers=admin).status_code == 404


def test_an_administrator_cannot_lock_themselves_out_or_delete_a_built_in_role(client, monkeypatch):
    admin = as_each(monkeypatch)("admin")
    listing = client.get(ROLES, headers=admin).get_json()
    mine = next(item for item in listing["items"] if item["code"] == "ADMINISTRATOR")
    without = [p for p in mine["permissions"] if p not in service.SELF_LOCKOUT_GUARD]
    locked = client.put(f"{ROLES}/ADMINISTRATOR", json={"permissions": without}, headers=admin)
    assert locked.status_code == 409 and "your own ability" in locked.get_json()["message"]

    built_in = client.delete(f"{ROLES}/MANAGER", headers=admin)
    assert built_in.status_code == 409 and "built-in" in built_in.get_json()["message"]
    assert client.delete(f"{ROLES}/ADMINISTRATOR", headers=admin).status_code == 409
