"""The reader's own security page (§41): sessions, sign-ins, and enforcement. — who may see it."""

from __future__ import annotations

from sqlalchemy import select

from src.core.db import session_scope
from src.services.people import security as service
from tests.security_support import (  # noqa: F401
    SECURITY,
    _authenticate,
    _failed_sign_in,
    _row,
    _sessions,
    pytestmark,
)


def test_no_permission_is_needed_to_see_your_own(client, monkeypatch):
    # A viewer holds almost nothing, and must still reach this page: a
    # security page that had to be granted is one most people never see.
    headers, _sid = _authenticate(monkeypatch, "user", "viewer")
    for url in ("/overview", "/sessions", "/sign-ins", "/events"):
        assert client.get(f"{SECURITY}{url}", headers=headers).status_code == 200, url


def test_a_caller_with_no_token_is_refused(client):
    for url in ("/overview", "/sessions", "/sign-ins", "/events"):
        assert client.get(f"{SECURITY}{url}").status_code == 401, url


def test_somebody_elses_session_is_not_there(client, monkeypatch):
    from src.models.identity import User, UserSession

    headers, _sid = _authenticate(monkeypatch, "analyst", "analyst")
    _sessions(client, headers)

    with session_scope() as session:
        me = session.scalar(select(User).where(User.username == "analyst"))
        theirs = session.scalar(
            select(UserSession).where(
                UserSession.user_id != me.id, UserSession.revoked_at.is_(None)
            )
        )
    assert theirs is not None, "the seed has no other people's sessions"

    listing = _sessions(client, headers)
    assert str(theirs.id) not in {item["id"] for item in listing["items"]}
    # And it cannot be revoked either — 404, not 403.
    assert client.delete(f"{SECURITY}/sessions/{theirs.id}", headers=headers).status_code == 404


def test_an_administrator_cannot_revoke_somebody_elses_session(client, monkeypatch):
    from src.models.identity import User, UserSession

    headers, _sid = _authenticate(monkeypatch, "admin", "administrator")
    with session_scope() as session:
        me = session.scalar(select(User).where(User.username == "admin"))
        theirs = session.scalar(
            select(UserSession).where(
                UserSession.user_id != me.id, UserSession.revoked_at.is_(None)
            )
        )
    assert theirs is not None

    # This page is about *your own* account. Signing somebody else out is an
    # administrative act and belongs on the person's own record, not here.
    assert client.delete(f"{SECURITY}/sessions/{theirs.id}", headers=headers).status_code == 404


def test_a_revocation_is_audited_without_the_token(client, monkeypatch):
    from src.models.platform import AuditLog

    headers, _sid = _authenticate(monkeypatch)
    mine = _row(client, headers)
    client.delete(f"{SECURITY}/sessions/{mine['id']}", headers=headers)

    with session_scope() as session:
        entry = session.scalar(
            select(AuditLog).where(
                AuditLog.resource_id == mine["id"], AuditLog.action == "session.revoke"
            )
        )
    assert entry is not None
    # A session id in the ledger would be a credential in the ledger.
    assert "token" not in str(entry.state_before or {})
    assert (entry.state_before or {}).get("device")


def test_the_overview_leads_with_the_failures_once_there_are_enough(client, monkeypatch):
    """One failed sign-in is a typo; three is worth a sentence at the top.

    Made rather than found, so the threshold is actually crossed — asserting
    that the flag *agrees with* the count would have passed on a persona with
    none, which is a test of arithmetic rather than of the decision.
    """
    for _ in range(service.FAILURES_WORTH_SAYING):
        _failed_sign_in("operator")

    headers, _sid = _authenticate(monkeypatch, "operator", "operator")
    body = client.get(f"{SECURITY}/overview", headers=headers).get_json()

    assert body["failed_sign_ins"] >= service.FAILURES_WORTH_SAYING
    assert body["failures_worth_saying"] is True
    # And where from, because "three failures" without an address is a fact
    # nobody can act on.
    assert "203.0.113.9" in body["failure_addresses"]
