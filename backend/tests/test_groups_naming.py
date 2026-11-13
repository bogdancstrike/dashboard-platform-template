"""Groups (§11): sets of people, and the permissions being in one adds. — naming."""

from __future__ import annotations

import pytest

from src.core import vocabulary
from src.core.auth import ALL_PERMISSIONS
from tests.groups_support import (  # noqa: F401
    GROUPS,
    _authenticate,
    _make,
    _persona_id,
    pytestmark,
)


def test_the_slug_is_derived_from_the_name(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    group = _make(client, headers, "On-call (weekends)")
    assert group["slug"] == "on-call-weekends"


def test_a_rename_moves_the_slug_with_it(client, monkeypatch):
    """Otherwise the handle keeps describing what the group used to be."""
    headers = _authenticate(monkeypatch)
    group = _make(client, headers, "Before rename")

    answer = client.put(f"{GROUPS}/{group['id']}", headers=headers, json={"name": "After rename"})
    assert answer.status_code == 200
    assert answer.get_json()["slug"] == "after-rename"


def test_two_groups_cannot_share_a_handle(client, monkeypatch):
    """The slug is what a URL and an integration hold on to."""
    headers = _authenticate(monkeypatch)
    _make(client, headers, "Duplicate handle")

    answer = client.post(GROUPS, headers=headers, json={"name": "duplicate handle"})
    assert answer.status_code == 409
    assert answer.get_json()["details"]["slug"] == "duplicate-handle"


def test_a_rename_that_would_collide_is_refused(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    first = _make(client, headers, "Collide target")
    second = _make(client, headers, "Collide source")

    answer = client.put(
        f"{GROUPS}/{second['id']}", headers=headers, json={"name": "Collide target"}
    )
    assert answer.status_code == 409
    assert first["slug"] == "collide-target"


@pytest.mark.parametrize("name", ["", " ", "x", "-starts-with-a-dash", "a" * 81])
def test_a_name_that_will_not_fit_a_chip_is_refused(client, monkeypatch, name):
    headers = _authenticate(monkeypatch)
    answer = client.post(GROUPS, headers=headers, json={"name": name})
    assert answer.status_code == 400


def test_a_kind_outside_the_vocabulary_is_refused_with_the_choices(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    answer = client.post(GROUPS, headers=headers, json={"name": "Odd kind", "kind": "SQUAD"})
    assert answer.status_code == 400
    assert answer.get_json()["details"]["allowed"] == list(vocabulary.GROUP_KIND)


def test_removing_a_group_says_what_it_costs(client, monkeypatch):
    """Allowed while occupied, unlike a role — a group is a set and the model
    is soft-delete. What it must not do is quietly reduce anybody's access."""
    headers = _authenticate(monkeypatch)
    group = _make(client, headers, "Costly removal")
    client.put(
        f"{GROUPS}/{group['id']}/grants",
        headers=headers,
        json={"permissions": ["audit.view", "logs.view"]},
    )
    client.put(
        f"{GROUPS}/{group['id']}/members",
        headers=headers,
        json={"user_ids": [str(_persona_id("operator")), str(_persona_id("analyst"))]},
    )

    answer = client.delete(f"{GROUPS}/{group['id']}", headers=headers)
    assert answer.status_code == 200
    body = answer.get_json()
    assert body["members_affected"] == 2
    assert body["permissions_withdrawn"] == ["audit.view", "logs.view"]


def test_a_removed_group_is_gone_from_the_listing(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    group = _make(client, headers, "Gone from listing")
    client.delete(f"{GROUPS}/{group['id']}", headers=headers)

    listing = client.get(f"{GROUPS}?page_size=100", headers=headers).get_json()
    assert group["id"] not in {row["id"] for row in listing["items"]}
    assert client.get(f"{GROUPS}/{group['id']}", headers=headers).status_code == 404


def test_the_catalogue_ships_the_permissions_the_code_checks_for(client, monkeypatch):
    """The grants editor offers exactly what an endpoint requires — the same
    reason the role matrix reads the catalogue instead of listing its own."""
    headers = _authenticate(monkeypatch)
    answer = client.get(f"{GROUPS}/catalogue", headers=headers).get_json()
    assert [item["code"] for item in answer["permissions"]] == list(ALL_PERMISSIONS)
    assert all(item["label"] for item in answer["permissions"])


def test_the_catalogue_offers_every_kind_even_the_empty_ones(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    answer = client.get(f"{GROUPS}/catalogue", headers=headers).get_json()
    assert [item["key"] for item in answer["kinds"]] == list(vocabulary.GROUP_KIND)


def test_the_catalogue_answers_both_privileges_separately(client, monkeypatch):
    """So the page decides once which halves of itself to draw, rather than
    guessing per control."""
    admin = client.get(f"{GROUPS}/catalogue", headers=_authenticate(monkeypatch)).get_json()
    assert admin["can_manage_members"] is True
    assert admin["can_manage_grants"] is True

    manager = client.get(
        f"{GROUPS}/catalogue", headers=_authenticate(monkeypatch, "manager", "manager")
    ).get_json()
    assert manager["can_manage_members"] is True
    assert manager["can_manage_grants"] is False

    viewer = client.get(
        f"{GROUPS}/catalogue", headers=_authenticate(monkeypatch, "user", "viewer")
    ).get_json()
    assert viewer["can_manage_members"] is False
    assert viewer["can_manage_grants"] is False


def test_every_seeded_group_grants_only_real_permissions(client, monkeypatch):
    """The seed asserts this at import; this asserts it of the *database*, which
    is what an older seeded installation actually has."""
    headers = _authenticate(monkeypatch)
    listing = client.get(f"{GROUPS}?page_size=100", headers=headers).get_json()
    for row in listing["items"]:
        unknown = set(row["permissions"]) - set(ALL_PERMISSIONS)
        assert not unknown, f"{row['name']} grants {unknown}"


def test_the_kinds_in_the_database_are_all_declared(client, monkeypatch):
    """A kind only in a seeded row is one the page's filter cannot offer."""
    headers = _authenticate(monkeypatch)
    listing = client.get(f"{GROUPS}?page_size=100", headers=headers).get_json()
    kinds = {row["kind"] for row in listing["items"]}
    assert kinds <= set(vocabulary.GROUP_KIND), kinds - set(vocabulary.GROUP_KIND)
