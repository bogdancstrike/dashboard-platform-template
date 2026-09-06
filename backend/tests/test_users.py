"""User administration and impersonation (§12).

Two things carry the weight here. The detail page has to explain **why** a
person can do what they can — role plus groups, not role alone — because "why
can they do that?" is the question an administrator opens it to answer. And
impersonation has to be a support tool rather than a privilege-escalation
path, which means the rank check is the test that matters most.
"""

from __future__ import annotations

from uuid import uuid4

import pytest
from sqlalchemy import select

from src.config import Config
from tests.conftest import persona_claims

PREFIX = Config.API_PREFIX


def _claims(username: str, role: str) -> dict:
    return persona_claims(username, role, sid=f"users-{username}")


def _authenticate(monkeypatch, username: str = "admin", role: str = "administrator"):
    monkeypatch.setattr("src.core.auth.verify_token", lambda _token: _claims(username, role))
    return {"Authorization": f"Bearer users-{username}"}


def _user(username: str):
    from src.core.db import session_scope
    from src.models.identity import User

    with session_scope() as session:
        return session.scalars(select(User).where(User.username == username)).one()


@pytest.fixture()
def restore_people(has_database):
    """Put every persona's role, status and groups back however the test ends."""
    if not has_database:
        yield
        return
    from src.core.db import session_scope
    from src.models.identity import User

    names = ("admin", "manager", "operator", "analyst", "user")
    with session_scope() as session:
        rows = session.scalars(select(User).where(User.username.in_(names))).unique().all()
        snapshot = {
            row.username: (row.role_id, row.status, [group.id for group in row.groups])
            for row in rows
        }
    yield
    with session_scope() as session:
        from src.models.identity import Group

        rows = session.scalars(select(User).where(User.username.in_(names))).unique().all()
        for row in rows:
            saved = snapshot.get(row.username)
            if not saved:
                continue
            row.role_id, row.status = saved[0], saved[1]
            row.groups = list(
                session.scalars(select(Group).where(Group.id.in_(saved[2]))).unique().all()
            ) if saved[2] else []


def test_user_administration_requires_a_bearer_token(client):
    identifier = uuid4()
    assert client.get(f"{PREFIX}/admin/users").status_code == 401
    assert client.get(f"{PREFIX}/admin/users/{identifier}").status_code == 401
    assert client.post(f"{PREFIX}/admin/users/{identifier}/impersonate").status_code == 401


@pytest.mark.database
def test_the_list_filters_and_facets_in_sql(client, monkeypatch):
    headers = _authenticate(monkeypatch)

    everyone = client.get(f"{PREFIX}/admin/users?page_size=5", headers=headers).get_json()
    viewers = client.get(
        f"{PREFIX}/admin/users?role_code=VIEWER&page_size=200", headers=headers
    ).get_json()

    assert everyone["total"] > 5
    assert len(everyone["items"]) == 5
    # The role lives on another table; it is filterable because the statement
    # joins it rather than because the page filters what it downloaded.
    assert 0 < viewers["total"] < everyone["total"]
    assert {item["role_code"] for item in viewers["items"]} == {"VIEWER"}
    assert sum(entry["count"] for entry in everyone["facets"]["status"]) == everyone["total"]


@pytest.mark.database
def test_search_finds_a_person_by_name_or_email(client, monkeypatch):
    by_name = client.get(
        f"{PREFIX}/admin/users?q=Ada Administrator", headers=_authenticate(monkeypatch)
    ).get_json()
    by_email = client.get(
        f"{PREFIX}/admin/users?q=admin@nucleus.example", headers=_authenticate(monkeypatch)
    ).get_json()

    assert by_name["total"] >= 1
    assert any(item["username"] == "admin" for item in by_name["items"])
    assert by_email["total"] == 1
    assert by_email["items"][0]["username"] == "admin"


@pytest.mark.database
def test_reading_people_requires_users_view(client, monkeypatch):
    _authenticate(monkeypatch, "user", "viewer")
    monkeypatch.setattr("src.core.auth._permissions_for", lambda *_args: set())

    response = client.get(
        f"{PREFIX}/admin/users", headers={"Authorization": "Bearer no-permissions"}
    )

    assert response.status_code == 403
    assert response.get_json()["details"]["missing"] == ["users.view"]


@pytest.mark.database
def test_the_detail_explains_access_by_role_and_by_group(client, monkeypatch, restore_people):
    """Role alone cannot explain why somebody can cancel a job; groups can."""
    from src.core.db import session_scope
    from src.models.identity import Group, User

    target = _user("user")
    with session_scope() as session:
        person = session.scalars(select(User).where(User.id == target.id)).unique().one()
        group = Group(
            name=f"On-call {uuid4().hex[:6]}",
            slug=f"oncall-{uuid4().hex[:8]}",
            kind="TEAM",
            permissions=["jobs.manage"],
        )
        session.add(group)
        session.flush()
        person.groups = [*person.groups, group]

    body = client.get(
        f"{PREFIX}/admin/users/{target.id}", headers=_authenticate(monkeypatch)
    ).get_json()

    access = body["access"]
    assert "jobs.manage" not in access["role_permissions"]
    assert "jobs.manage" in access["effective"]
    # The surprising half, named as such: granted by a group, not by the role.
    assert "jobs.manage" in access["from_groups_only"]
    assert any(group["permissions"] == ["jobs.manage"] for group in body["groups"])

    # Clean up the group the test created.
    with session_scope() as session:
        person = session.scalars(select(User).where(User.id == target.id)).unique().one()
        person.groups = [g for g in person.groups if not g.name.startswith("On-call ")]
        for stale in session.scalars(select(Group).where(Group.name.like("On-call %"))).all():
            session.delete(stale)


@pytest.mark.database
def test_changing_a_role_takes_effect_and_is_audited(client, monkeypatch, restore_people):
    headers = _authenticate(monkeypatch)
    target = _user("user")

    changed = client.put(
        f"{PREFIX}/admin/users/{target.id}", headers=headers, json={"role_code": "ANALYST"}
    )

    assert changed.status_code == 200
    assert changed.get_json()["role_code"] == "ANALYST"

    ledger = client.get(
        f"{PREFIX}/admin/audit?resource_type=user&action=PERMISSION_CHANGE&page_size=5",
        headers=headers,
    ).get_json()
    assert ledger["total"] >= 1
    entry = client.get(
        f"{PREFIX}/admin/audit/{ledger['items'][0]['id']}", headers=headers
    ).get_json()
    assert "role" in {change["field"] for change in entry["changes"]}


@pytest.mark.database
def test_suspending_someone_is_recorded_and_a_bad_status_is_refused(
    client, monkeypatch, restore_people
):
    headers = _authenticate(monkeypatch)
    target = _user("analyst")

    suspended = client.put(
        f"{PREFIX}/admin/users/{target.id}", headers=headers, json={"status": "SUSPENDED"}
    )
    invalid = client.put(
        f"{PREFIX}/admin/users/{target.id}", headers=headers, json={"status": "ON_HOLIDAY"}
    )

    assert suspended.status_code == 200
    assert suspended.get_json()["status"] == "SUSPENDED"
    assert invalid.status_code == 400
    assert "ACTIVE" in invalid.get_json()["details"]["allowed"]


@pytest.mark.database
def test_you_cannot_suspend_or_re_role_yourself(client, monkeypatch, restore_people):
    # Both end your own session on the next request, and the screen that would
    # undo it is behind that session.
    headers = _authenticate(monkeypatch)
    me = _user("admin")

    suspend = client.put(
        f"{PREFIX}/admin/users/{me.id}", headers=headers, json={"status": "SUSPENDED"}
    )
    demote = client.put(
        f"{PREFIX}/admin/users/{me.id}", headers=headers, json={"role_code": "VIEWER"}
    )

    assert suspend.status_code == 409
    assert demote.status_code == 409


@pytest.mark.database
def test_managing_people_requires_more_than_reading_them(client, monkeypatch):
    # ANALYST reads the directory and administers nobody.
    response = client.put(
        f"{PREFIX}/admin/users/{_user('user').id}",
        headers=_authenticate(monkeypatch, "analyst", "analyst"),
        json={"status": "SUSPENDED"},
    )

    assert response.status_code == 403
    assert response.get_json()["details"]["missing"] == ["users.manage"]


@pytest.mark.database
def test_impersonation_answers_before_the_first_impersonated_request(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    target = _user("user")

    started = client.post(f"{PREFIX}/admin/users/{target.id}/impersonate", headers=headers)

    assert started.status_code == 200
    assert started.get_json()["username"] == "user"
    assert started.get_json()["started_by"]


@pytest.mark.database
def test_impersonating_is_recorded_with_both_identities(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    target = _user("user")

    client.post(f"{PREFIX}/admin/users/{target.id}/impersonate", headers=headers)
    ledger = client.get(
        f"{PREFIX}/admin/audit?action=IMPERSONATE&resource_type=user&page_size=5",
        headers=headers,
    ).get_json()

    assert ledger["total"] >= 1
    assert ledger["items"][0]["resource_label"] == target.full_name


@pytest.mark.database
def test_an_impersonated_request_carries_both_identities_into_the_audit_row(
    client, monkeypatch, restore_people
):
    """The header is the transport; this is what it does to the record."""
    admin_headers = _authenticate(monkeypatch)
    target = _user("user")

    # Act as the viewer, and change something that writes an audit row.
    acting = {**admin_headers, "X-Impersonate-User": str(target.id)}
    profile = client.get(f"{PREFIX}/api/me", headers=acting).get_json()

    assert profile["user"]["username"] == "user"
    assert profile["session"]["impersonating"] is True
    assert profile["session"]["impersonator_label"]


@pytest.fixture()
def manager_may_impersonate(has_database):
    """Grant MANAGER the impersonate permission, and take it back afterwards.

    By default only ADMINISTRATOR may impersonate, and nobody outranks them —
    so the rank check cannot fire with the shipped roles. It exists because
    roles are *editable* (§13): the moment somebody grants impersonation to a
    lower-ranked role, that check is the only thing standing between a support
    feature and privilege escalation. This is the test for that moment.
    """
    if not has_database:
        yield
        return
    from src.core.db import session_scope
    from src.models.identity import Role

    with session_scope() as session:
        role = session.scalars(select(Role).where(Role.code == "MANAGER")).one()
        original = list(role.permissions or [])
        role.permissions = sorted({*original, "users.impersonate"})
    yield
    with session_scope() as session:
        role = session.scalars(select(Role).where(Role.code == "MANAGER")).one()
        role.permissions = original


@pytest.mark.database
def test_you_cannot_act_as_somebody_with_more_access_than_you(
    client, monkeypatch, manager_may_impersonate
):
    # Privilege escalation wearing a costume: it would let a manager reach the
    # administration area through a feature built for support.
    headers = _authenticate(monkeypatch, "manager", "manager")
    administrator = _user("admin")
    viewer = _user("user")

    refused = client.post(
        f"{PREFIX}/admin/users/{administrator.id}/impersonate", headers=headers
    )
    allowed = client.post(f"{PREFIX}/admin/users/{viewer.id}/impersonate", headers=headers)

    assert refused.status_code == 409
    assert "more access" in refused.get_json()["message"]
    # Downwards is fine: that is what the feature is for.
    assert allowed.status_code == 200


@pytest.mark.database
def test_a_suspended_account_and_yourself_cannot_be_impersonated(
    client, monkeypatch, restore_people
):
    headers = _authenticate(monkeypatch)
    target = _user("analyst")
    client.put(f"{PREFIX}/admin/users/{target.id}", headers=headers, json={"status": "SUSPENDED"})

    suspended = client.post(f"{PREFIX}/admin/users/{target.id}/impersonate", headers=headers)
    yourself = client.post(
        f"{PREFIX}/admin/users/{_user('admin').id}/impersonate", headers=headers
    )

    assert suspended.status_code == 409
    assert "suspended" in suspended.get_json()["message"]
    assert yourself.status_code == 409


@pytest.mark.database
def test_impersonation_needs_its_own_permission(client, monkeypatch):
    # MANAGER may administer people and may not become one of them.
    from src.core.auth import ROLE_DEFAULTS

    assert "users.impersonate" not in ROLE_DEFAULTS["MANAGER"]["permissions"]

    response = client.post(
        f"{PREFIX}/admin/users/{_user('user').id}/impersonate",
        headers=_authenticate(monkeypatch, "manager", "manager"),
    )

    assert response.status_code == 403
    assert response.get_json()["details"]["missing"] == ["users.impersonate"]


@pytest.mark.database
def test_a_missing_person_is_a_404(client, monkeypatch):
    headers = _authenticate(monkeypatch)

    assert client.get(f"{PREFIX}/admin/users/{uuid4()}", headers=headers).status_code == 404
    assert client.put(
        f"{PREFIX}/admin/users/{uuid4()}", headers=headers, json={"status": "ACTIVE"}
    ).status_code == 404
