"""Changing somebody's access: the rules an administrator meets on the user drawer.

`test_users` covers listing and the detail view. These change a disposable
person (provisioned by signing in once) — status, role, groups — and pin each
refusal: an unknown status/role/group, an administrator suspending or demoting
themselves, and impersonating somebody who is not active.
"""

from __future__ import annotations

import uuid

import pytest

from src.core import auth
from tests.personas import PREFIX, as_each

USERS = f"{PREFIX}/admin/users"

pytestmark = pytest.mark.database


@pytest.fixture()
def newcomer(client, monkeypatch):
    """A fresh profile, made the way a first sign-in makes one."""
    from sqlalchemy import select

    from src.core.db import session_scope
    from src.models.identity import User

    name = f"drawer{uuid.uuid4().hex[:6]}"
    claims = {"sub": f"kc-{name}", "email": f"{name}@nucleus.example", "preferred_username": name,
              "name": "Drawer Probe", "sid": f"cov-{name}", "realm_access": {"roles": ["user"]}}
    real = auth.verify_token
    monkeypatch.setattr(auth, "verify_token", lambda _token: claims)
    assert client.get(f"{PREFIX}/api/me", headers={"Authorization": "Bearer x"}).status_code == 200
    monkeypatch.setattr(auth, "verify_token", real)
    with session_scope() as session:
        return str(session.scalar(select(User.id).where(User.username == name)))


def test_status_role_and_groups_change_and_are_refused_when_wrong(client, monkeypatch, newcomer):
    from sqlalchemy import select

    from src.core.db import session_scope
    from src.models.identity import Group

    admin = as_each(monkeypatch)("admin")
    with session_scope() as session:
        group_id = str(session.scalar(select(Group.id).where(Group.deleted_at.is_(None)).limit(1)))

    def put(**body):
        return client.put(f"{USERS}/{newcomer}", json=body, headers=admin)

    changed = put(status="suspended", role_code="ANALYST", group_ids=[group_id])
    assert changed.status_code == 200, changed.get_json()
    body = changed.get_json()
    assert body["status"] == "SUSPENDED"
    assert (body.get("role") or {}).get("code", body.get("role_code")) in ("ANALYST", None) or "ANALYST" in str(body)
    assert group_id in str(body)

    # The same values again change nothing, and clearing the groups works.
    assert put(status="SUSPENDED").status_code == 200
    assert group_id not in str(put(group_ids=[]).get_json().get("groups", []))

    for bad, status in (({"status": "ON_HOLIDAY"}, 400), ({"role_code": "EMPEROR"}, 404),
                        ({"group_ids": group_id}, 400),
                        ({"group_ids": ["00000000-0000-0000-0000-000000000000"]}, 404)):
        response = put(**bad)
        assert response.status_code == status, (bad, response.get_json())
    assert client.put(f"{USERS}/{newcomer}", json=["x"], headers=admin).status_code == 400

    # Impersonating an account that is not active is refused with the reason.
    acting = client.post(f"{USERS}/{newcomer}/impersonate", headers=admin)
    assert acting.status_code in (403, 409) and "suspended" in acting.get_json()["message"].lower()


def test_an_administrator_cannot_lock_themselves_out(client, monkeypatch):
    from sqlalchemy import select

    from src.core.db import session_scope
    from src.models.identity import User

    admin = as_each(monkeypatch)("admin")
    with session_scope() as session:
        me = str(session.scalar(select(User.id).where(User.username == "admin")))
    suspend = client.put(f"{USERS}/{me}", json={"status": "SUSPENDED"}, headers=admin)
    assert suspend.status_code == 409 and "your own account" in suspend.get_json()["message"]
    demote = client.put(f"{USERS}/{me}", json={"role_code": "VIEWER"}, headers=admin)
    assert demote.status_code == 409 and "your own role" in demote.get_json()["message"]
    assert client.put(f"{USERS}/{me}", json={"status": "ACTIVE"}, headers=admin).status_code == 200
    assert client.post(f"{USERS}/{me}/impersonate", headers=admin).status_code in (403, 409)


def test_somebody_without_the_permission_cannot_change_access(client, monkeypatch, newcomer):
    viewer = as_each(monkeypatch)("user")
    assert client.put(f"{USERS}/{newcomer}", json={"status": "ACTIVE"}, headers=viewer).status_code == 403
