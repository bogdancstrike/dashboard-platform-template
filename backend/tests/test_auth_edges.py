"""Who a request is, at the edges: new people, suspended people, impersonation, odd tokens.

`test_auth` covers the token itself and the guards. These pin what happens
after a token is accepted — a realm identity with no local profile yet, an
account that has been suspended, an administrator acting as somebody else, a
token with no session id — plus the small helpers every audit row and session
row is built from.
"""

from __future__ import annotations

import uuid

import pytest
from werkzeug.datastructures import Headers

from src.config import Config
from src.core import auth
from src.core.errors import ValidationError
from tests.conftest import persona_claims
from tests.personas import PREFIX, sign_in

ME = f"{PREFIX}/api/me"


@pytest.mark.parametrize(("agent", "device"), [
    ("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)", "Mobile"),
    ("Mozilla/5.0 (Linux; Android 14)", "Mobile"),
    ("Mozilla/5.0 (iPad; CPU OS 17_0)", "Tablet"),
    ("curl/8.4.0", "API client"),
    ("python-requests/2.32", "API client"),
    ("Mozilla/5.0 ... Edg/120.0", "Edge"),
    ("Mozilla/5.0 ... Chrome/120.0 Safari/537.36", "Chrome"),
    ("Mozilla/5.0 ... Firefox/121.0", "Firefox"),
    ("Mozilla/5.0 (Macintosh) ... Safari/605.1.15", "Safari"),
    ("something new", "Unknown"),
])
def test_a_user_agent_is_named_in_a_word(agent, device):
    assert auth.device_of(agent) == device


def test_the_highest_mapped_role_wins_and_an_unmapped_one_reads_only():
    assert auth.role_from_claims({}) == auth.DEFAULT_ROLE_CODE
    assert auth.role_from_claims({"realm_access": {"roles": ["offline_access"]}}) == auth.DEFAULT_ROLE_CODE
    claims = {"realm_access": {"roles": ["user"]},
              "resource_access": {Config.KEYCLOAK_AUDIENCE: {"roles": ["manager"]}}}
    assert auth.role_from_claims(claims) == "MANAGER"
    assert auth._expiry({"exp": "soon"}) == 0.0 and auth._expiry({"exp": 5}) == 5.0


def test_a_request_body_is_a_json_object_or_nothing(app):
    for data, expected in ((b"", {}), (b"null", {}), (b'{"a": 1}', {"a": 1})):
        with app.test_request_context("/", method="POST", data=data, content_type="application/json"):
            assert auth.json_body() == expected
    for data, says in ((b"{not json", "valid JSON"), (b"[1, 2]", "JSON object")):
        with app.test_request_context("/", method="POST", data=data, content_type="application/json"):
            with pytest.raises(ValidationError, match=says):
                auth.json_body()


def test_the_caller_is_resolved_once_per_request(app, monkeypatch):
    calls = {"n": 0}

    def verify(_token):
        calls["n"] += 1
        return persona_claims("admin", "administrator", sid="cov-once")

    monkeypatch.setattr(auth, "verify_token", verify)
    with app.test_request_context("/", headers=Headers({"Authorization": "Bearer x"})):
        if not __import__("os").getenv("TEST_DATABASE_URL"):
            pytest.skip("needs the database")
        first = auth.principal_from_request()
        assert auth.principal_from_request() is first and auth.me() is first and auth.maybe_me() is first
    assert calls["n"] == 1


@pytest.mark.database
def test_a_new_realm_identity_gets_a_profile_and_a_suspended_one_is_refused(client, monkeypatch):
    from sqlalchemy import select

    from src.core.db import session_scope
    from src.models.identity import User

    name = f"newcomer{uuid.uuid4().hex[:6]}"
    claims = {"sub": f"kc-{name}", "email": f"{name}@nucleus.example", "preferred_username": name,
              "name": "New Comer", "sid": f"cov-{name}", "realm_access": {"roles": ["analyst"]}}
    monkeypatch.setattr(auth, "verify_token", lambda _token: claims)
    headers = {"Authorization": f"Bearer {name}"}

    monkeypatch.setattr(Config, "AUTO_PROVISION_USERS", False)
    refused = client.get(ME, headers=headers)
    assert refused.status_code == 403 and "No platform profile" in refused.get_json()["message"]

    monkeypatch.setattr(Config, "AUTO_PROVISION_USERS", True)
    me = client.get(ME, headers=headers)
    assert me.status_code == 200, me.get_json()
    with session_scope() as session:
        user = session.scalars(select(User).where(User.username == name)).one()
        assert user.first_name == "New" and user.last_name == "Comer" and user.role.code == "ANALYST"
        user.status = "SUSPENDED"

    suspended = client.get(ME, headers={"Authorization": f"Bearer {name}", "X-Request": "again"})
    assert suspended.status_code == 403 and "suspended" in suspended.get_json()["message"]


@pytest.mark.database
def test_a_token_without_a_session_id_records_no_session(client, monkeypatch):
    from sqlalchemy import func, select

    from src.core.db import session_scope
    from src.models.identity import UserSession

    claims = persona_claims("analyst", "analyst", sid="")
    claims["sid"] = ""
    monkeypatch.setattr(auth, "verify_token", lambda _token: claims)
    with session_scope() as session:
        before = session.scalar(select(func.count()).select_from(UserSession))
    assert client.get(ME, headers={"Authorization": "Bearer nosid"}).status_code == 200
    with session_scope() as session:
        assert session.scalar(select(func.count()).select_from(UserSession)) == before


@pytest.mark.database
def test_an_administrator_acts_as_somebody_else_by_email_or_id(client, monkeypatch):
    from sqlalchemy import select

    from src.core.db import session_scope
    from src.models.identity import User

    headers = sign_in(monkeypatch, "admin")
    with session_scope() as session:
        manager_id = session.scalar(select(User.id).where(User.username == "manager"))

    for target in ("MANAGER@nucleus.example", str(manager_id)):
        body = client.get(ME, headers={**headers, "X-Impersonate-User": target}).get_json()
        who = body.get("user") or body
        assert who["username"] == "manager", body
        flags = {key: value for part in (body, who, body.get("session") or {}) if isinstance(part, dict)
                 for key, value in part.items() if key.startswith("impersonat")}
        assert flags.get("impersonating") is True and flags.get("impersonator_label") == "Ada Administrator", body

    missing = client.get(ME, headers={**headers, "X-Impersonate-User": "nobody@nowhere.example"})
    assert missing.status_code == 404

    # Somebody without the permission is simply themselves.
    viewer = sign_in(monkeypatch, "user")
    body = client.get(ME, headers={**viewer, "X-Impersonate-User": str(manager_id)}).get_json()
    assert (body.get("user") or body)["username"] == "user"
