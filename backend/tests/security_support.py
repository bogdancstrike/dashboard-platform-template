"""Shared helpers and fixtures for the security tests."""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select

from src.config import Config
from src.core.db import session_scope
from tests.conftest import persona_claims

pytestmark = pytest.mark.database


PREFIX = Config.API_PREFIX


SECURITY = f"{PREFIX}/security"


#: Bearer token → the claims it verifies to, for the whole test.
#:
#: A single `monkeypatch.setattr` returning one set of claims cannot express
#: what this module needs to test: *two live sessions on one account*, which is
#: the situation "sign out everywhere else" exists for. Patching to a
#: dispatcher instead means each token is its own session, which is what a
#: token is.
_CLAIMS: dict[str, dict] = {}


@pytest.fixture(autouse=True)
def _tokens(monkeypatch):
    _CLAIMS.clear()

    def verify(token: str) -> dict:
        claims = _CLAIMS.get(token)
        if claims is None:
            from src.core.errors import UnauthorizedError

            raise UnauthorizedError("Unknown test token.")
        return claims

    monkeypatch.setattr("src.core.auth.tokens.verify_token", verify)
    yield
    _CLAIMS.clear()


def _authenticate(monkeypatch, username: str = "analyst", role: str = "analyst", *, sid: str = ""):
    """Sign in as a persona, with a session id this test controls.

    The `sid` is the whole point: it is what `core/auth` records the session
    against and what a revocation is checked against, so a test that wants to
    revoke its own session has to know it. Each call is a *distinct* token, so
    two of them are two sessions rather than one under two names.
    """
    session_id = sid or f"sec-{username}-{uuid.uuid4().hex[:8]}"
    token = f"tok-{session_id}"
    _CLAIMS[token] = persona_claims(username, role, sid=session_id)
    return {"Authorization": f"Bearer {token}"}, session_id


def _sessions(client, headers) -> dict:
    answer = client.get(f"{SECURITY}/sessions", headers=headers)
    assert answer.status_code == 200, answer.get_json()
    return answer.get_json()


def _failed_sign_in(username: str, *, address: str = "203.0.113.9") -> str:
    """A failed sign-in on this persona's account.

    Made rather than found. The first version of these tests looked for a
    seeded failure and skipped when the draw had left this persona none —
    which is the "four tests quietly not running" mistake the integrations
    suite already made once. A failure is the row this page exists to show, so
    a test about it must not depend on a coin flip.
    """
    from src.models.identity import LoginEvent, User

    with session_scope() as session:
        user = session.scalar(select(User).where(User.username == username))
        assert user is not None, f"{username} is not seeded"
        row = LoginEvent(
            user_id=user.id,
            email=user.email,
            result="FAILURE",
            reason="Wrong password",
            ip_address=address,
            user_agent="Mozilla/5.0 (Macintosh) Safari/605",
            device="Safari",
            location="Bucharest, RO",
            method="PASSWORD",
        )
        session.add(row)
        session.flush()
        return str(row.id)


def _security_event(username: str, *, severity: str = "WARNING") -> str:
    """A security event on this persona's account, made for the same reason."""
    from src.models.identity import SecurityEvent, User

    with session_scope() as session:
        user = session.scalar(select(User).where(User.username == username))
        assert user is not None, f"{username} is not seeded"
        row = SecurityEvent(
            user_id=user.id,
            kind="NEW_DEVICE_SIGN_IN",
            severity=severity,
            title="Sign-in from a new device",
            description="A device this account has not been seen on before.",
            ip_address="203.0.113.9",
            resolved=False,
        )
        session.add(row)
        session.flush()
        return str(row.id)


def _row(client, headers, *, current: bool = True) -> dict:
    listing = _sessions(client, headers)
    found = [item for item in listing["items"] if item["current"] is current]
    assert found, f"no session with current={current}"
    return found[0]


class _Session:
    """Only the three fields `state` reads."""

    def __init__(self, revoked_at=None, expires_at=None):
        self.revoked_at = revoked_at
        self.expires_at = expires_at
