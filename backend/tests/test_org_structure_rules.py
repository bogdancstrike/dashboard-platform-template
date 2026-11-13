"""Editing a tenant and its department tree: what is refused, and why.

`test_organizations` covers the listing and the happy-path tree. These pin the
refusals the structure editor depends on — names and codes, tiers and
statuses, a negative head count, a department placed under one from another
organization, inside itself, under its own descendant, or past `MAX_DEPTH` —
and the partial edits that clear a value.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select

from src.services import organizations as service
from tests.personas import PREFIX, as_each

ORGS = f"{PREFIX}/admin/organizations"
DEPARTMENTS = f"{PREFIX}/admin/departments"

pytestmark = pytest.mark.database


def _two_organizations():
    from src.core.db import session_scope
    from src.models.identity import Organization

    with session_scope() as session:
        ids = session.scalars(select(Organization.id).where(Organization.deleted_at.is_(None))
                              .order_by(Organization.name).limit(2)).all()
    if len(ids) < 2:
        pytest.skip("the seed has one organization")
    return [str(i) for i in ids]


def test_a_tenant_edit_checks_every_field_and_clears_blanks(client, monkeypatch):
    admin = as_each(monkeypatch)("admin")
    org, _other = _two_organizations()
    for bad in ({"name": "x"}, {"tier": "PLATINUM-PLUS"}, {"status": "NAPPING"},
                {"employee_count": "many"}, {"employee_count": -3}):
        response = client.put(f"{ORGS}/{org}", json=bad, headers=admin)
        assert response.status_code == 400, (bad, response.get_json())
    assert client.put(f"{ORGS}/{uuid.uuid4()}", json={"name": "Valid Name"}, headers=admin).status_code == 404

    original = client.get(f"{ORGS}/{org}", headers=admin).get_json()
    original = original.get("organization") or original
    edited = client.put(f"{ORGS}/{org}", json={
        "name": f"{original['name']} Probe", "website": "   ", "employee_count": "12",
        "tier": original.get("tier", "STANDARD").lower(),
    }, headers=admin)
    assert edited.status_code == 200, edited.get_json()
    body = edited.get_json()
    body = body.get("organization") or body
    assert body["name"].endswith("Probe") and body.get("website") in (None, "")


def test_the_tree_refuses_cycles_strangers_and_depth(client, monkeypatch):
    admin = as_each(monkeypatch)("admin")
    org, other = _two_organizations()

    def department(organization, name, parent=None):
        body = {"name": name, "code": f"p-{uuid.uuid4().hex[:6]}"}
        if parent:
            body["parent_id"] = parent
        response = client.post(f"{ORGS}/{organization}/departments", json=body, headers=admin)
        assert response.status_code == 201, response.get_json()
        return response.get_json()["id"]

    for bad in ({"name": "!", "code": "ok-1"}, {"name": "Fine", "code": "no spaces!"}):
        assert client.post(f"{ORGS}/{org}/departments", json=bad, headers=admin).status_code == 400

    root = department(org, "Probe root")
    chain = [root]
    for level in range(1, service.MAX_DEPTH):
        chain.append(department(org, f"Probe level {level}", chain[-1]))
    stranger = department(other, "Probe stranger")

    # Created under a department of another organization.
    refused = client.post(f"{ORGS}/{org}/departments",
                          json={"name": "Probe x", "code": "px-1", "parent_id": stranger}, headers=admin)
    assert refused.status_code == 400 and "another organization" in refused.get_json()["message"]

    def move(department_id, **body):
        return client.put(f"{DEPARTMENTS}/{department_id}", json=body, headers=admin)

    assert move(root, parent_id=root).status_code == 409                       # inside itself
    cycle = move(root, parent_id=chain[-1])                                      # under its descendant
    assert cycle.status_code == 409 and "inside itself" in cycle.get_json()["message"]
    assert "→" in cycle.get_json()["message"]
    assert move(root, parent_id=stranger).status_code == 400                     # another organization
    leaf = department(org, "Probe leaf")
    too_deep = move(leaf, parent_id=chain[-1])
    assert too_deep.status_code == 409 and "as deep as" in too_deep.get_json()["message"]

    # A partial edit: rename, recode, describe, then lift to the top.
    edited = move(chain[1], name="Probe renamed", code="pr-edit", description="  ", cost_center="CC-9",
                  parent_id=None)
    assert edited.status_code == 200, edited.get_json()
    body = edited.get_json()
    assert body["name"] == "Probe renamed" and body["code"] == "PR-EDIT" and body.get("parent_id") in (None, "")
    assert move(str(uuid.uuid4()), name="Nobody").status_code == 404


def test_a_slug_and_an_ancestry_survive_odd_input():
    assert service._slug("  !!!  ") == "organization"
    assert service._slug("Acme & Sons, Ltd.") == "acme-sons-ltd"
