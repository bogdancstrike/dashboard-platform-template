"""Organizations, departments and teams (§42): the shape of the company. — retiring."""

from __future__ import annotations

import pytest

from src.core import vocabulary
from src.services.people import organizations as service
from tests.organizations_support import (  # noqa: F401
    DEPARTMENTS,
    ORGS,
    _any_organization,
    _authenticate,
    _make_department,
    pytestmark,
)


def test_a_department_with_people_in_it_cannot_be_retired(client, monkeypatch):
    """A department is a *place*, unlike a group which is a set — and the
    foreign keys cascade, so a silent delete would take its teams with it and
    leave its people pointing at nothing."""
    headers = _authenticate(monkeypatch)
    organization = _any_organization(client, headers)
    tree = client.get(f"{ORGS}/{organization['id']}", headers=headers).get_json()

    occupied = next(
        (node for node in tree["departments"] if node["people"] > 0 or node["children"]),
        None,
    )
    if occupied is None:
        pytest.skip("no seeded department has anything in it")

    answer = client.delete(f"{DEPARTMENTS}/{occupied['id']}", headers=headers)
    assert answer.status_code == 409
    assert "Move them first" in answer.get_json()["message"]
    # And the message says what is in the way, in the words somebody needs.
    details = answer.get_json()["details"]
    assert details["people"] + details["teams"] + details["children"] > 0


def test_an_empty_department_is_retired(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    organization = _any_organization(client, headers)
    created = _make_department(client, headers, organization["id"], name="Empty and going")

    answer = client.delete(f"{DEPARTMENTS}/{created['id']}", headers=headers)
    assert answer.status_code == 200
    assert answer.get_json()["deleted"] is True

    tree = client.get(f"{ORGS}/{organization['id']}", headers=headers).get_json()

    def walk(nodes):
        for node in nodes:
            yield node["id"]
            yield from walk(node["children"])

    assert created["id"] not in set(walk(tree["departments"]))


def test_a_sub_department_blocks_its_parent(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    organization = _any_organization(client, headers)
    parent = _make_department(client, headers, organization["id"], name="Blocked parent")
    _make_department(client, headers, organization["id"], name="Blocking child", parent_id=parent["id"])

    answer = client.delete(f"{DEPARTMENTS}/{parent['id']}", headers=headers)
    assert answer.status_code == 409
    assert answer.get_json()["details"]["children"] == 1


def test_a_tenants_details_can_be_edited(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    organization = _any_organization(client, headers)

    answer = client.put(
        f"{ORGS}/{organization['id']}",
        headers=headers,
        json={"industry": "Logistics", "city": "Rotterdam", "employee_count": 4200},
    )
    assert answer.status_code == 200
    body = answer.get_json()
    assert body["industry"] == "Logistics"
    assert body["employee_count"] == 4200


def test_a_tier_outside_the_vocabulary_is_refused_with_the_choices(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    organization = _any_organization(client, headers)
    answer = client.put(f"{ORGS}/{organization['id']}", headers=headers, json={"tier": "PLATINUM"})
    assert answer.status_code == 400
    assert answer.get_json()["details"]["allowed"] == list(vocabulary.ORG_TIER)


def test_a_negative_employee_count_is_refused(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    organization = _any_organization(client, headers)
    answer = client.put(
        f"{ORGS}/{organization['id']}", headers=headers, json={"employee_count": -5}
    )
    assert answer.status_code == 400


def test_the_tiers_in_the_database_are_all_declared(client, monkeypatch):
    """A tier only in a seeded row is one the page's filter cannot offer."""
    headers = _authenticate(monkeypatch)
    listing = client.get(f"{ORGS}?page_size=100", headers=headers).get_json()
    tiers = {row["tier"] for row in listing["items"]}
    assert tiers <= set(vocabulary.ORG_TIER), tiers - set(vocabulary.ORG_TIER)


def test_the_catalogue_carries_the_regions_and_the_reader_s_own_tenant(client, monkeypatch):
    """So the page opens on the tenant somebody belongs to rather than guessing
    which of four to show."""
    headers = _authenticate(monkeypatch)
    answer = client.get(f"{ORGS}/catalogue", headers=headers).get_json()
    assert answer["regions"], "the seed has regions"
    assert all(region["timezone"] for region in answer["regions"])
    assert answer["tiers"] == list(vocabulary.ORG_TIER)
    assert answer["max_depth"] == service.MAX_DEPTH


def test_reading_the_structure_needs_only_the_directory(client, monkeypatch):
    """Where somebody sits is directory information, so `users.view` reads it."""
    headers = _authenticate(monkeypatch, "user", "viewer")
    assert client.get(ORGS, headers=headers).status_code == 200
    assert client.get(f"{ORGS}/catalogue", headers=headers).status_code == 200


def test_changing_it_needs_orgs_manage(client, monkeypatch):
    """A manager holds `users.manage` and not `orgs.manage`: managing people is
    not the same as redrawing the company."""
    admin = _authenticate(monkeypatch)
    organization = _any_organization(client, admin)

    manager = _authenticate(monkeypatch, "manager", "manager")
    assert client.get(f"{ORGS}/{organization['id']}", headers=manager).status_code == 200
    assert (
        client.put(f"{ORGS}/{organization['id']}", headers=manager, json={"city": "Nope"}).status_code
        == 403
    )
    assert (
        client.post(
            f"{ORGS}/{organization['id']}/departments",
            headers=manager,
            json={"name": "Nope", "code": "NOPE"},
        ).status_code
        == 403
    )


def test_the_catalogue_says_whether_the_reader_may_change_anything(client, monkeypatch):
    admin = client.get(f"{ORGS}/catalogue", headers=_authenticate(monkeypatch)).get_json()
    assert admin["can_manage"] is True

    manager = client.get(
        f"{ORGS}/catalogue", headers=_authenticate(monkeypatch, "manager", "manager")
    ).get_json()
    assert manager["can_manage"] is False


def test_a_tenants_revenue_is_not_directory_information(client, monkeypatch):
    """Reading the structure is open at `users.view`, which every role holds —
    so the one commercially sensitive field on the record is withheld unless
    the reader may manage organisations. Withheld rather than zeroed, so a
    reader can tell "not shown to you" from "nothing"."""
    admin = _authenticate(monkeypatch)
    mine = _any_organization(client, admin)
    assert "annual_revenue" in mine

    viewer = _authenticate(monkeypatch, "user", "viewer")
    theirs = client.get(f"{ORGS}?page_size=5", headers=viewer).get_json()["items"][0]
    assert "annual_revenue" not in theirs
    # But the structure itself is readable: that is the point of the split.
    assert theirs["people"] >= 0
    assert theirs["name"]

    tree = client.get(f"{ORGS}/{mine['id']}", headers=viewer).get_json()
    assert "annual_revenue" not in tree["organization"]
    assert tree["departments"] is not None
