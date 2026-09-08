"""Groups (§11): sets of people, and the permissions being in one adds.

The claim this module exists for, and the one worth reading first: **editing a
group's grants is a different privilege from editing its membership**, because
`core/auth._permissions_for` unions a group's permissions onto its members'
roles. A manager holds `users.manage` and not `roles.manage`; if one permission
covered both, a manager could add `roles.manage` to a group they are in and
have it on their next request. `test_a_manager_cannot_escalate_through_a_group`
is that assertion, and it is the reason this service is split the way it is.

The rest:

  * a grant is checked against the **permission catalogue**, because a group
    granting `records.expport` grants nothing and looks in every screen exactly
    like one that works;
  * membership is set as a **whole list**, so two administrators cannot
    interleave into a state neither chose;
  * it takes effect **on the next request**, with no re-login — the same claim
    the role matrix makes, and for the same reason;
  * deleting a group is allowed and **says what it costs**, since a soft-delete
    that silently withdrew permissions would be the worst of both;
  * and a retired group stops granting, which needs its membership rows gone
    and not merely a flag set.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select

from src.config import Config
from src.core import vocabulary
from src.core.auth import ALL_PERMISSIONS
from src.core.db import session_scope
from src.services import groups as service
from tests.conftest import persona_claims

pytestmark = pytest.mark.database

PREFIX = Config.API_PREFIX
GROUPS = f"{PREFIX}/admin/groups"


def _authenticate(monkeypatch, username: str = "admin", role: str = "administrator"):
    monkeypatch.setattr(
        "src.core.auth.verify_token",
        lambda _token: persona_claims(username, role, sid=f"grp-{username}"),
    )
    return {"Authorization": f"Bearer grp-{username}"}


def _make(client, headers, name: str | None = None, **extra) -> dict:
    """A group of this test's own, so nothing here edits a seeded one."""
    body = {"name": name or f"Test group {uuid.uuid4().hex[:8]}", **extra}
    answer = client.post(GROUPS, headers=headers, json=body)
    assert answer.status_code == 201, answer.get_json()
    return answer.get_json()


def _persona_id(username: str) -> uuid.UUID:
    from src.models.identity import User

    with session_scope() as session:
        user = session.scalar(select(User).where(User.username == username))
        assert user is not None, f"the seed has no {username}"
        return user.id


# ── the privilege boundary ───────────────────────────────────────────────


def test_a_manager_cannot_escalate_through_a_group(client, monkeypatch):
    """The reason this service is split in two.

    A manager may put people in groups. If that also let them say what a group
    grants, they could add `roles.manage` to a group containing themselves and
    hold it on their next request — so `users.manage` would silently be worth
    every permission in the catalogue.
    """
    manager = _authenticate(monkeypatch, "manager", "manager")
    group = _make(client, manager, "Escalation attempt")

    refused = client.put(
        f"{GROUPS}/{group['id']}/grants",
        headers=manager,
        json={"permissions": ["roles.manage"]},
    )
    assert refused.status_code == 403

    # And not through the back door either: the plain update endpoint refuses
    # the field rather than quietly dropping it.
    sneaked = client.put(
        f"{GROUPS}/{group['id']}",
        headers=manager,
        json={"name": "Escalation attempt", "permissions": ["roles.manage"]},
    )
    assert sneaked.status_code == 400
    assert "roles.manage" in sneaked.get_json()["message"]

    # The group still grants nothing.
    read = client.get(f"{GROUPS}/{group['id']}", headers=manager).get_json()
    assert read["permissions"] == []


def test_a_manager_may_still_manage_membership(client, monkeypatch):
    """The other half: the split must not make `users.manage` useless."""
    manager = _authenticate(monkeypatch, "manager", "manager")
    group = _make(client, manager, "Managed by a manager")

    answer = client.put(
        f"{GROUPS}/{group['id']}/members",
        headers=manager,
        json={"user_ids": [str(_persona_id("operator"))]},
    )
    assert answer.status_code == 200
    assert answer.get_json()["member_count"] == 1


def test_a_new_group_never_arrives_with_grants(client, monkeypatch):
    """Whatever the payload says.

    Otherwise creating a group would need two privileges, and the create form
    would be one level or two depending on what somebody typed into it.
    """
    manager = _authenticate(monkeypatch, "manager", "manager")
    answer = client.post(
        GROUPS,
        headers=manager,
        json={"name": "Arrives empty", "permissions": ["roles.manage", "records.view"]},
    )
    assert answer.status_code == 201
    assert answer.get_json()["permissions"] == []


def test_an_administrator_may_set_grants(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    group = _make(client, headers, "Granting group")

    answer = client.put(
        f"{GROUPS}/{group['id']}/grants",
        headers=headers,
        json={"permissions": ["records.export", "audit.view"]},
    )
    assert answer.status_code == 200
    body = answer.get_json()
    assert body["permissions"] == ["audit.view", "records.export"]
    assert body["added"] == ["audit.view", "records.export"]
    assert body["removed"] == []


def test_reading_groups_needs_no_more_than_the_directory(client, monkeypatch):
    """A group's membership is directory information, so `users.view` reads it —
    the same permission the user list needs. A viewer holds it."""
    headers = _authenticate(monkeypatch, "user", "viewer")
    assert client.get(GROUPS, headers=headers).status_code == 200
    # And can change nothing.
    assert client.post(GROUPS, headers=headers, json={"name": "Nope"}).status_code == 403


# ── what a group may grant ───────────────────────────────────────────────


def test_a_grant_is_checked_against_the_permission_catalogue(client, monkeypatch):
    """A group granting `records.expport` grants nothing at all, and looks in
    every screen exactly like one that works — the quietest way to believe
    somebody has access they do not."""
    headers = _authenticate(monkeypatch)
    group = _make(client, headers, "Typo group")

    answer = client.put(
        f"{GROUPS}/{group['id']}/grants",
        headers=headers,
        json={"permissions": ["records.expport"]},
    )
    assert answer.status_code == 400
    details = answer.get_json()["details"]
    assert details["unknown"] == ["records.expport"]
    # The near-misses, because the cause is almost always a typo.
    assert any(code.startswith("records.") for code in details["did_you_mean"])


def test_grants_are_stored_sorted_and_deduplicated(client, monkeypatch):
    """So two groups granting the same set store the same array, and a diff
    between them is about the permissions rather than the order they were
    clicked in."""
    headers = _authenticate(monkeypatch)
    group = _make(client, headers, "Tidy grants")

    answer = client.put(
        f"{GROUPS}/{group['id']}/grants",
        headers=headers,
        json={"permissions": ["records.view", "audit.view", "records.view"]},
    )
    assert answer.get_json()["permissions"] == ["audit.view", "records.view"]


def test_setting_the_same_grants_twice_is_quiet(client, monkeypatch):
    """An unchanged save should not write an audit row claiming a change."""
    headers = _authenticate(monkeypatch)
    group = _make(client, headers, "Unchanged grants")
    client.put(
        f"{GROUPS}/{group['id']}/grants", headers=headers, json={"permissions": ["audit.view"]}
    )

    from src.models.platform import AuditLog

    with session_scope() as session:
        before = len(
            session.scalars(
                select(AuditLog).where(
                    AuditLog.resource_type == "group", AuditLog.resource_id == group["id"]
                )
            ).all()
        )
    client.put(
        f"{GROUPS}/{group['id']}/grants", headers=headers, json={"permissions": ["audit.view"]}
    )
    with session_scope() as session:
        after = len(
            session.scalars(
                select(AuditLog).where(
                    AuditLog.resource_type == "group", AuditLog.resource_id == group["id"]
                )
            ).all()
        )
    assert after == before


def test_the_audit_row_names_what_moved(client, monkeypatch):
    """"The permissions changed" is the one audit message nobody can act on."""
    headers = _authenticate(monkeypatch)
    group = _make(client, headers, "Audited grants")
    client.put(
        f"{GROUPS}/{group['id']}/grants",
        headers=headers,
        json={"permissions": ["audit.view", "records.view"]},
    )
    client.put(
        f"{GROUPS}/{group['id']}/grants",
        headers=headers,
        json={"permissions": ["records.view", "logs.view"]},
    )

    from src.models.platform import AuditLog

    with session_scope() as session:
        row = session.scalar(
            select(AuditLog)
            .where(AuditLog.resource_type == "group", AuditLog.resource_id == group["id"])
            .order_by(AuditLog.occurred_at.desc())
        )
    assert row is not None
    assert "+logs.view" in row.message
    assert "-audit.view" in row.message


# ── it takes effect ──────────────────────────────────────────────────────


def test_a_group_grants_its_permissions_on_the_next_request(client, monkeypatch):
    """The claim that makes this screen worth having.

    Same as the role matrix: `_permissions_for` reads the tables on every
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
    """Soft-delete is a flag, and `_permissions_for` walks the relationship —
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


# ── membership ───────────────────────────────────────────────────────────


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


# ── naming ───────────────────────────────────────────────────────────────


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


# ── retiring ─────────────────────────────────────────────────────────────


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


# ── the catalogue ────────────────────────────────────────────────────────


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
