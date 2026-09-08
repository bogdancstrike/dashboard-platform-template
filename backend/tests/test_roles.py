"""Roles and the permission matrix (§13).

The property the whole screen rests on is that it shows and edits what is
actually in force — `core/auth._permissions_for` reads the `roles` table on
every request, so an edit here has to change what the next request may do. A
matrix that displayed the shipped defaults while the database said something
else would be worse than no matrix at all.
"""

from __future__ import annotations

import pytest

from src.config import Config
from tests.conftest import persona_claims

PREFIX = Config.API_PREFIX


def _claims(username: str, role: str) -> dict:
    return persona_claims(username, role, sid=f"roles-{username}")


def _authenticate(monkeypatch, username: str = "admin", role: str = "administrator"):
    monkeypatch.setattr("src.core.auth.verify_token", lambda _token: _claims(username, role))
    return {"Authorization": f"Bearer roles-{username}"}


@pytest.fixture()
def restore_roles(has_database):
    """Put every role's permissions back however the test ends.

    These tests edit live authorization against the demo database. Leaving a
    role changed would silently alter what every later test — and every later
    demo — is allowed to do.
    """
    if not has_database:
        yield
        return

    from sqlalchemy import select

    from src.core.db import session_scope
    from src.models.identity import Role

    with session_scope() as session:
        snapshot = {
            row.code: (row.name, row.description, list(row.permissions or []))
            for row in session.scalars(select(Role)).all()
        }
    yield
    with session_scope() as session:
        for row in session.scalars(select(Role)).all():
            saved = snapshot.get(row.code)
            if saved:
                row.name, row.description, row.permissions = saved


def test_the_matrix_requires_a_bearer_token(client):
    assert client.get(f"{PREFIX}/admin/roles").status_code == 401
    assert client.put(f"{PREFIX}/admin/roles/VIEWER", json={}).status_code == 401


@pytest.mark.database
def test_reading_the_matrix_requires_roles_manage(client, monkeypatch):
    # MANAGER administers people but not the permission model itself.
    response = client.get(
        f"{PREFIX}/admin/roles", headers=_authenticate(monkeypatch, "manager", "manager")
    )

    assert response.status_code == 403
    assert response.get_json()["details"]["missing"] == ["roles.manage"]


@pytest.mark.database
def test_the_matrix_publishes_every_permission_the_code_checks_for(client, monkeypatch):
    from src.core.auth import ALL_PERMISSIONS

    body = client.get(f"{PREFIX}/admin/roles", headers=_authenticate(monkeypatch)).get_json()

    listed = {
        permission["code"]
        for group in body["permissions"]["groups"]
        for permission in group["permissions"]
    }
    # Every permission an endpoint can require appears on the screen that
    # grants it; nothing else does.
    assert listed == set(ALL_PERMISSIONS)
    assert body["permissions"]["total"] == len(ALL_PERMISSIONS)


@pytest.mark.database
def test_the_matrix_shows_what_is_in_force_not_the_shipped_defaults(
    client, monkeypatch, restore_roles
):
    from sqlalchemy import select

    from src.core.db import session_scope
    from src.models.identity import Role

    # Change the table behind the API's back, the way a migration or another
    # administrator would.
    with session_scope() as session:
        viewer = session.scalars(select(Role).where(Role.code == "VIEWER")).one()
        viewer.permissions = sorted({*viewer.permissions, "jobs.view"})

    body = client.get(f"{PREFIX}/admin/roles", headers=_authenticate(monkeypatch)).get_json()
    role = next(item for item in body["items"] if item["code"] == "VIEWER")

    assert "jobs.view" in role["permissions"]
    # And it says so: a role that has drifted from its defaults is marked.
    assert role["customised"] is True
    assert "jobs.view" not in role["default_permissions"]


@pytest.mark.database
def test_each_role_carries_how_many_people_hold_it(client, monkeypatch):
    body = client.get(f"{PREFIX}/admin/roles", headers=_authenticate(monkeypatch)).get_json()

    assert body["total"] > 0
    assert sum(item["user_count"] for item in body["items"]) > 0
    # Ordered strongest first, which is how the matrix reads left to right.
    ranks = [item["rank"] for item in body["items"]]
    assert ranks == sorted(ranks, reverse=True)
    assert body["your_role"] == "ADMINISTRATOR"
    assert next(item for item in body["items"] if item["code"] == "ADMINISTRATOR")["is_yours"]


@pytest.mark.database
def test_editing_a_role_changes_what_its_holders_may_do_on_the_next_request(
    client, monkeypatch, restore_roles
):
    """§13's acceptance criterion, asserted end to end rather than described."""
    headers = _authenticate(monkeypatch)

    # A viewer cannot reach the audit ledger…
    viewer_headers = _authenticate(monkeypatch, "user", "viewer")
    assert client.get(f"{PREFIX}/admin/audit", headers=viewer_headers).status_code == 403

    # …an administrator grants the permission…
    _authenticate(monkeypatch)
    granted = client.put(
        f"{PREFIX}/admin/roles/VIEWER",
        headers=headers,
        json={"permissions": ["records.view", "audit.view"]},
    )
    assert granted.status_code == 200
    assert set(granted.get_json()["permissions"]) == {"records.view", "audit.view"}

    # …and the very next request the viewer makes is allowed. No re-login, no
    # cache to invalidate: the permission came from the table.
    viewer_headers = _authenticate(monkeypatch, "user", "viewer")
    assert client.get(f"{PREFIX}/admin/audit", headers=viewer_headers).status_code == 200


@pytest.mark.database
def test_an_edit_is_audited_with_the_permissions_it_moved(client, monkeypatch, restore_roles):
    headers = _authenticate(monkeypatch)

    client.put(
        f"{PREFIX}/admin/roles/VIEWER",
        headers=headers,
        json={"permissions": ["records.view", "reports.view"]},
    )

    ledger = client.get(
        f"{PREFIX}/admin/audit?action=PERMISSION_CHANGE&resource_type=role&page_size=5",
        headers=headers,
    ).get_json()

    assert ledger["total"] >= 1
    entry = client.get(
        f"{PREFIX}/admin/audit/{ledger['items'][0]['id']}", headers=headers
    ).get_json()
    changed = {change["field"] for change in entry["changes"]}
    assert "permissions" in changed


@pytest.mark.database
def test_you_cannot_lock_yourself_out_of_the_screen_you_are_using(
    client, monkeypatch, restore_roles
):
    # The change that cannot be undone from inside the application: the screen
    # that would undo it is the one you have just closed to yourself.
    headers = _authenticate(monkeypatch)

    refused = client.put(
        f"{PREFIX}/admin/roles/ADMINISTRATOR",
        headers=headers,
        json={"permissions": ["records.view"]},
    )

    assert refused.status_code == 409
    assert "roles.manage" in refused.get_json()["details"]["would_remove"]
    # And nothing moved.
    body = client.get(f"{PREFIX}/admin/roles", headers=headers).get_json()
    admin_role = next(item for item in body["items"] if item["code"] == "ADMINISTRATOR")
    assert "roles.manage" in admin_role["permissions"]


@pytest.mark.database
def test_a_permission_nothing_checks_for_cannot_be_granted(client, monkeypatch, restore_roles):
    # A role granting `reports.publish` when no endpoint requires it reads on
    # the matrix as a capability its holders do not have.
    response = client.put(
        f"{PREFIX}/admin/roles/VIEWER",
        headers=_authenticate(monkeypatch),
        json={"permissions": ["records.view", "reports.publish"]},
    )

    assert response.status_code == 400
    assert response.get_json()["details"]["permissions"] == ["reports.publish"]


@pytest.mark.database
def test_an_unknown_role_and_a_malformed_body_are_client_errors(
    client, monkeypatch, restore_roles
):
    headers = _authenticate(monkeypatch)

    missing = client.put(f"{PREFIX}/admin/roles/WIZARD", headers=headers, json={"name": "Wizard"})
    malformed = client.put(
        f"{PREFIX}/admin/roles/VIEWER", headers=headers, json={"permissions": "records.view"}
    )
    blank = client.put(f"{PREFIX}/admin/roles/VIEWER", headers=headers, json={"name": "  "})

    assert missing.status_code == 404
    assert malformed.status_code == 400
    assert blank.status_code == 400


@pytest.mark.database
def test_renaming_a_role_leaves_its_permissions_alone(client, monkeypatch, restore_roles):
    headers = _authenticate(monkeypatch)
    before = client.get(f"{PREFIX}/admin/roles", headers=headers).get_json()
    viewer = next(item for item in before["items"] if item["code"] == "VIEWER")

    renamed = client.put(
        f"{PREFIX}/admin/roles/VIEWER", headers=headers, json={"name": "Read-only"}
    ).get_json()

    assert renamed["name"] == "Read-only"
    assert renamed["permissions"] == viewer["permissions"]

# ── Roles an installation adds (§13) ─────────────────────────────────────


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
    comes back on the next deploy — and `_permissions_for` reads a row that
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
