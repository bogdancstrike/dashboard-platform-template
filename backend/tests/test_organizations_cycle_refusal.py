"""Organizations, departments and teams (§42): the shape of the company. — the cycle refusal."""

from __future__ import annotations

import uuid

import pytest

from src.core.db import session_scope
from src.services.people import organizations as service
from tests.organizations_support import (  # noqa: F401
    DEPARTMENTS,
    ORGS,
    _any_organization,
    _authenticate,
    _make_department,
    pytestmark,
)


def test_a_department_cannot_sit_inside_itself(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    organization = _any_organization(client, headers)
    department = _make_department(client, headers, organization["id"])

    answer = client.put(
        f"{DEPARTMENTS}/{department['id']}",
        headers=headers,
        json={"parent_id": department["id"]},
    )
    assert answer.status_code == 409
    assert "inside itself" in answer.get_json()["message"]


def test_a_department_cannot_sit_inside_its_own_child(client, monkeypatch):
    """The version that actually happens: two moves that each look fine and
    together make the tree infinite. The refusal names the path, because
    "invalid parent" leaves somebody guessing which of four levels was wrong.
    """
    headers = _authenticate(monkeypatch)
    organization = _any_organization(client, headers)
    grandparent = _make_department(client, headers, organization["id"], name="Cycle top")
    parent = _make_department(
        client, headers, organization["id"], name="Cycle middle", parent_id=grandparent["id"]
    )
    child = _make_department(
        client, headers, organization["id"], name="Cycle bottom", parent_id=parent["id"]
    )

    answer = client.put(
        f"{DEPARTMENTS}/{grandparent['id']}", headers=headers, json={"parent_id": child["id"]}
    )
    assert answer.status_code == 409
    body = answer.get_json()
    assert "inside itself" in body["message"]
    # The path, so the operator can see where the loop closes.
    assert "Cycle top" in body["message"]
    assert len(body["details"]["path"]) == 3


def test_the_ancestry_walk_terminates_even_on_a_broken_tree(client, monkeypatch):
    """The function that detects cycles must not be the one that hangs on them.

    Written directly against a cycle the API refuses to create, because the
    guarantee is about the code and not about whether the data can reach that
    state.
    """
    headers = _authenticate(monkeypatch)
    organization = _any_organization(client, headers)
    first = _make_department(client, headers, organization["id"], name="Loop one")
    second = _make_department(
        client, headers, organization["id"], name="Loop two", parent_id=first["id"]
    )

    from src.models.identity import Department

    with session_scope() as session:
        # Forced past the API, which is the only way this state exists.
        top = session.get(Department, uuid.UUID(first["id"]))
        top.parent_id = uuid.UUID(second["id"])
        session.flush()

        chain = service._ancestry(session, top)
        assert len(chain) <= service.MAX_DEPTH + 2
        assert service._depth_of(session, top) <= service.MAX_DEPTH + 2

        # Put it back so the autouse cleanup can delete both.
        top.parent_id = None
    assert headers


def test_the_structure_has_a_depth_limit(client, monkeypatch):
    """A legibility limit rather than a technical one: four levels is already
    more nesting than anybody holds in their head, and the indentation runs
    out of room before the data runs out of depth."""
    headers = _authenticate(monkeypatch)
    organization = _any_organization(client, headers)

    parent_id = None
    made = []
    for level in range(service.MAX_DEPTH):
        body = {"name": f"Deep {level}", "code": f"DEEP{level}"}
        if parent_id:
            body["parent_id"] = parent_id
        answer = client.post(f"{ORGS}/{organization['id']}/departments", headers=headers, json=body)
        if answer.status_code == 409:
            # The limit, reached.
            assert answer.get_json()["details"]["max_depth"] == service.MAX_DEPTH
            assert level > 0
            return
        assert answer.status_code == 201, answer.get_json()
        made.append(answer.get_json())
        parent_id = answer.get_json()["id"]

    # If every level was allowed, one more must not be.
    answer = client.post(
        f"{ORGS}/{organization['id']}/departments",
        headers=headers,
        json={"name": "Too deep", "code": "TOODEEP", "parent_id": parent_id},
    )
    assert answer.status_code == 409
    assert answer.get_json()["details"]["max_depth"] == service.MAX_DEPTH


def test_a_department_cannot_move_into_another_organization(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    listing = client.get(f"{ORGS}?page_size=5", headers=headers).get_json()
    if len(listing["items"]) < 2:
        pytest.skip("only one organization is seeded")

    first, second = listing["items"][0], listing["items"][1]
    mine = _make_department(client, headers, first["id"], name="Stays put")
    theirs = client.get(f"{ORGS}/{second['id']}", headers=headers).get_json()
    if not theirs["departments"]:
        pytest.skip("the second organization has no departments")

    answer = client.put(
        f"{DEPARTMENTS}/{mine['id']}",
        headers=headers,
        json={"parent_id": theirs["departments"][0]["id"]},
    )
    assert answer.status_code == 400
    assert "another organization" in answer.get_json()["message"]


def test_a_code_is_upper_cased_rather_than_refused(client, monkeypatch):
    """`eng` and `ENG` are the same code to everybody except a string
    comparison, and refusing one would enforce a rule nobody can see."""
    headers = _authenticate(monkeypatch)
    organization = _any_organization(client, headers)
    created = _make_department(client, headers, organization["id"], code="lower-1")
    assert created["code"] == "LOWER-1"


def test_two_departments_in_one_organization_cannot_share_a_code(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    organization = _any_organization(client, headers)
    first = _make_department(client, headers, organization["id"], code="DUPE1")

    answer = client.post(
        f"{ORGS}/{organization['id']}/departments",
        headers=headers,
        json={"name": "Second", "code": "dupe1"},
    )
    assert answer.status_code == 409
    assert first["code"] in answer.get_json()["details"]["code"]


@pytest.mark.parametrize("code", ["", "x", "has space", "-leading", "a" * 33])
def test_a_code_that_will_not_do_is_refused(client, monkeypatch, code):
    headers = _authenticate(monkeypatch)
    organization = _any_organization(client, headers)
    answer = client.post(
        f"{ORGS}/{organization['id']}/departments",
        headers=headers,
        json={"name": "Bad code", "code": code},
    )
    assert answer.status_code == 400


def test_a_department_can_be_renamed_and_moved_to_the_top(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    organization = _any_organization(client, headers)
    parent = _make_department(client, headers, organization["id"], name="Old parent")
    child = _make_department(
        client, headers, organization["id"], name="Was nested", parent_id=parent["id"]
    )

    answer = client.put(
        f"{DEPARTMENTS}/{child['id']}",
        headers=headers,
        json={"name": "Now a root", "parent_id": None},
    )
    assert answer.status_code == 200
    body = answer.get_json()
    assert body["name"] == "Now a root"
    assert body["parent_id"] is None
