"""Groups (§11): sets of people, and the permissions being in one adds. — the privilege boundary."""

from __future__ import annotations

from sqlalchemy import select

from src.core.db import session_scope
from tests.groups_support import (  # noqa: F401
    GROUPS,
    _authenticate,
    _make,
    _persona_id,
    pytestmark,
)


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
