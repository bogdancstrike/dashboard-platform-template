"""Groups (§11): sets of people, and the permissions being in one adds. — it takes effect."""

from __future__ import annotations

import uuid

from sqlalchemy import select

from src.core.db import session_scope
from tests.groups_support import (  # noqa: F401
    GROUPS,
    PREFIX,
    _authenticate,
    _make,
    _persona_id,
    pytestmark,
)


def test_a_group_grants_its_permissions_on_the_next_request(client, monkeypatch):
    """The claim that makes this screen worth having.

    Same as the role matrix: `permissions_for` reads the tables on every
    request, so a person added to a group holds its permissions immediately —
    no re-login, no cache to bust.
    """
    admin = _authenticate(monkeypatch)
    group = _make(client, admin, "Grants audit view")
    client.put(
        f"{GROUPS}/{group['id']}/grants", headers=admin, json={"permissions": ["audit.view"]}
    )

    # The operator cannot read the ledger.
    operator = _authenticate(monkeypatch, "operator", "operator")
    assert client.get(f"{PREFIX}/admin/audit", headers=operator).status_code == 403

    admin = _authenticate(monkeypatch)
    client.put(
        f"{GROUPS}/{group['id']}/members",
        headers=admin,
        json={"user_ids": [str(_persona_id("operator"))]},
    )

    # And now they can, without signing in again.
    operator = _authenticate(monkeypatch, "operator", "operator")
    assert client.get(f"{PREFIX}/admin/audit", headers=operator).status_code == 200


def test_removing_somebody_takes_the_permission_away_again(client, monkeypatch):
    """The other direction, which is the one a security review asks about."""
    admin = _authenticate(monkeypatch)
    group = _make(client, admin, "Temporary access")
    client.put(
        f"{GROUPS}/{group['id']}/grants", headers=admin, json={"permissions": ["audit.view"]}
    )
    client.put(
        f"{GROUPS}/{group['id']}/members",
        headers=admin,
        json={"user_ids": [str(_persona_id("operator"))]},
    )

    operator = _authenticate(monkeypatch, "operator", "operator")
    assert client.get(f"{PREFIX}/admin/audit", headers=operator).status_code == 200

    admin = _authenticate(monkeypatch)
    client.put(f"{GROUPS}/{group['id']}/members", headers=admin, json={"user_ids": []})

    operator = _authenticate(monkeypatch, "operator", "operator")
    assert client.get(f"{PREFIX}/admin/audit", headers=operator).status_code == 403


def test_a_retired_group_stops_granting(client, monkeypatch):
    """Soft-delete is a flag, and `permissions_for` walks the relationship —
    so a retired group whose membership rows survived would go on granting
    everything it granted, invisibly, because no screen lists it any more."""
    admin = _authenticate(monkeypatch)
    group = _make(client, admin, "Retired access")
    client.put(
        f"{GROUPS}/{group['id']}/grants", headers=admin, json={"permissions": ["audit.view"]}
    )
    client.put(
        f"{GROUPS}/{group['id']}/members",
        headers=admin,
        json={"user_ids": [str(_persona_id("operator"))]},
    )

    operator = _authenticate(monkeypatch, "operator", "operator")
    assert client.get(f"{PREFIX}/admin/audit", headers=operator).status_code == 200

    admin = _authenticate(monkeypatch)
    removed = client.delete(f"{GROUPS}/{group['id']}", headers=admin)
    assert removed.status_code == 200

    operator = _authenticate(monkeypatch, "operator", "operator")
    assert client.get(f"{PREFIX}/admin/audit", headers=operator).status_code == 403


def test_membership_is_set_as_a_whole_list(client, monkeypatch):
    """Not a delta: the request says what the group *is*, so two
    administrators editing at once cannot interleave into a third state."""
    headers = _authenticate(monkeypatch)
    group = _make(client, headers, "Whole membership")

    first = client.put(
        f"{GROUPS}/{group['id']}/members",
        headers=headers,
        json={"user_ids": [str(_persona_id("operator")), str(_persona_id("analyst"))]},
    ).get_json()
    assert first["member_count"] == 2
    assert first["added"] == 2

    second = client.put(
        f"{GROUPS}/{group['id']}/members",
        headers=headers,
        json={"user_ids": [str(_persona_id("analyst"))]},
    ).get_json()
    assert second["member_count"] == 1
    assert second["removed"] == 1
    assert second["added"] == 0


def test_a_member_who_does_not_exist_is_refused_rather_than_skipped(client, monkeypatch):
    """Silently dropping an unknown id would leave the caller believing they
    added somebody."""
    headers = _authenticate(monkeypatch)
    group = _make(client, headers, "Unknown member")

    stranger = str(uuid.uuid4())
    answer = client.put(
        f"{GROUPS}/{group['id']}/members", headers=headers, json={"user_ids": [stranger]}
    )
    assert answer.status_code == 400
    assert answer.get_json()["details"]["unknown"] == [stranger]


def test_the_member_count_is_one_query_not_one_per_row(client, monkeypatch):
    """A page of twenty groups should not be twenty counts. Asserted through
    the listing rather than by counting SQL, because what matters is that the
    numbers are right for every row at once."""
    headers = _authenticate(monkeypatch)
    listing = client.get(f"{GROUPS}?page_size=50", headers=headers).get_json()

    from src.models.identity import Group, user_groups

    with session_scope() as session:
        for row in listing["items"]:
            actual = len(
                session.scalars(
                    select(user_groups.c.user_id).where(
                        user_groups.c.group_id == uuid.UUID(row["id"])
                    )
                ).all()
            )
            assert row["member_count"] == actual, row["name"]
        assert Group is not None
