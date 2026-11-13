"""Roles and the permission matrix (§13). — Roles an installation adds (§13)."""

from __future__ import annotations

import pytest

from tests.roles_support import (  # noqa: F401
    PREFIX,
    _authenticate,
    restore_roles,
)


@pytest.mark.database
def test_a_custom_role_can_be_created_and_removed(client, monkeypatch):
    """The gap this closes: `is_system` had been on the model from the start,
    every screen rendered it, and there was no way to make a role that was not
    one."""
    headers = _authenticate(monkeypatch)

    created = client.post(
        f"{PREFIX}/admin/roles",
        json={
            "code": "AUDITOR_TEST",
            "name": "External auditor",
            "description": "Reads the ledger and the audit trail, writes nothing.",
            "permissions": ["records.view", "audit.view"],
        },
        headers=headers,
    )
    assert created.status_code == 201, created.get_data(as_text=True)
    body = created.get_json()
    assert body["code"] == "AUDITOR_TEST"
    assert set(body["permissions"]) == {"records.view", "audit.view"}
    # Never a system role, whatever was asked for: that flag is what protects
    # the seeded five, and a request that could set it could opt out of the
    # protection.
    assert body["is_system"] is False

    # It is in force immediately — the matrix reads the table, not the seed.
    listing = client.get(f"{PREFIX}/admin/roles", headers=headers).get_json()
    assert "AUDITOR_TEST" in [item["code"] for item in listing["items"]]

    removed = client.delete(f"{PREFIX}/admin/roles/AUDITOR_TEST", headers=headers)
    assert removed.status_code == 200
    assert removed.get_json()["deleted"] is True


@pytest.mark.database
def test_a_created_role_cannot_claim_to_be_a_built_in_one(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    response = client.post(
        f"{PREFIX}/admin/roles",
        json={"code": "MANAGER", "name": "Not the real one"},
        headers=headers,
    )
    assert response.status_code == 409
    assert "built-in" in response.get_json()["message"]


@pytest.mark.database
def test_a_role_code_is_an_identifier_and_says_so(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    for code in ("", "a", "has spaces", "sym-bols!"):
        response = client.post(
            f"{PREFIX}/admin/roles", json={"code": code, "name": "x"}, headers=headers
        )
        assert response.status_code == 400, code


@pytest.mark.database
def test_a_created_role_grants_only_permissions_the_code_checks_for(client, monkeypatch):
    """The same rule editing one already follows: a role granting something
    nothing checks reads on the matrix as a capability nobody has."""
    headers = _authenticate(monkeypatch)
    response = client.post(
        f"{PREFIX}/admin/roles",
        json={"code": "MADE_UP_TEST", "name": "Made up", "permissions": ["reports.publish"]},
        headers=headers,
    )
    assert response.status_code == 400
    assert "reports.publish" in response.get_data(as_text=True)


@pytest.mark.database
def test_a_built_in_role_cannot_be_deleted(client, monkeypatch):
    """The seed writes it and `--sync-roles` maintains it, so a deleted one
    comes back on the next deploy — and `permissions_for` reads a row that
    vanished in between."""
    headers = _authenticate(monkeypatch)
    response = client.delete(f"{PREFIX}/admin/roles/VIEWER", headers=headers)
    assert response.status_code == 409
    assert "built-in" in response.get_json()["message"]

    # And it is still there.
    listing = client.get(f"{PREFIX}/admin/roles", headers=headers).get_json()
    assert "VIEWER" in [item["code"] for item in listing["items"]]


@pytest.mark.database
def test_a_role_somebody_holds_cannot_be_deleted_and_the_number_is_named(
    client, monkeypatch
):
    """A cascade would silently leave people with no permissions at all, which
    reads to them as the platform being broken."""
    headers = _authenticate(monkeypatch)
    client.post(
        f"{PREFIX}/admin/roles",
        json={"code": "HELD_TEST", "name": "Held by somebody", "permissions": ["records.view"]},
        headers=headers,
    )

    from sqlalchemy import select

    from src.core.db import session_scope
    from src.models.identity import Role, User

    with session_scope() as session:
        role = session.scalars(select(Role).where(Role.code == "HELD_TEST")).one()
        somebody = session.scalars(select(User).where(User.username == "operator")).one()
        was = somebody.role_id
        somebody.role_id = role.id
        session.flush()

    try:
        response = client.delete(f"{PREFIX}/admin/roles/HELD_TEST", headers=headers)
        assert response.status_code == 409
        assert response.get_json()["details"]["holders"] == 1
        assert "Move them to another role first" in response.get_json()["message"]
    finally:
        with session_scope() as session:
            somebody = session.scalars(select(User).where(User.username == "operator")).one()
            somebody.role_id = was
            session.flush()

    assert client.delete(f"{PREFIX}/admin/roles/HELD_TEST", headers=headers).status_code == 200


@pytest.mark.database
def test_nobody_can_delete_the_role_they_are_signed_in_with(client, monkeypatch):
    """The same reasoning as the self-lockout guard on editing: the screen that
    would undo it is the screen you have just removed yourself from."""
    headers = _authenticate(monkeypatch)
    response = client.delete(f"{PREFIX}/admin/roles/ADMINISTRATOR", headers=headers)
    # Refused as a built-in first, which is the stronger reason.
    assert response.status_code == 409


@pytest.mark.database
def test_creating_a_role_is_audited(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    client.post(
        f"{PREFIX}/admin/roles",
        json={"code": "AUDITED_TEST", "name": "Audited", "permissions": ["records.view"]},
        headers=headers,
    )

    from sqlalchemy import select

    from src.core.db import session_scope
    from src.models.platform import AuditLog

    with session_scope() as session:
        entry = session.scalars(
            select(AuditLog)
            .where(AuditLog.resource_type == "role", AuditLog.resource_label == "Audited")
            .order_by(AuditLog.occurred_at.desc())
        ).first()
        assert entry is not None
        assert entry.state_after["permissions"] == ["records.view"]

    client.delete(f"{PREFIX}/admin/roles/AUDITED_TEST", headers=headers)


@pytest.mark.database
def test_a_role_a_reader_may_not_manage_cannot_be_created(client, monkeypatch):
    headers = _authenticate(monkeypatch, "manager", "manager")
    assert client.post(
        f"{PREFIX}/admin/roles", json={"code": "NOPE_TEST", "name": "No"}, headers=headers
    ).status_code == 403
