"""The reader's own security page (§41): sessions, sign-ins, and enforcement. — the state of one session."""

from __future__ import annotations

from sqlalchemy import select

from src.core.clock import now
from src.core.db import session_scope
from src.services.people import security as service
from tests.security_support import (  # noqa: F401
    PREFIX,
    SECURITY,
    _Session,
    _authenticate,
    _row,
    _sessions,
    _tokens,
    pytestmark,
)


def test_revoked_expired_and_active_are_three_different_things():
    from datetime import timedelta

    moment = now()
    # Collapsing the first two into "inactive" would hide the only one anybody
    # acted on.
    assert service.state(_Session(revoked_at=moment)) == "REVOKED"
    assert service.state(_Session(expires_at=moment - timedelta(hours=1))) == "EXPIRED"
    assert service.state(_Session(expires_at=moment + timedelta(hours=1))) == "ACTIVE"
    assert service.state(_Session()) == "ACTIVE"


def test_a_revoked_session_is_revoked_whatever_its_expiry_says():
    from datetime import timedelta

    # Somebody's decision outranks the clock: a session signed out an hour ago
    # is not "expired" merely because its token also ran out.
    row = _Session(revoked_at=now(), expires_at=now() - timedelta(hours=2))
    assert service.state(row) == "REVOKED"


def test_the_session_making_the_request_is_recorded(client, monkeypatch):
    headers, sid = _authenticate(monkeypatch)
    listing = _sessions(client, headers)

    # Without this the page lists the seeded sessions and never the one the
    # reader is looking at it from, which is the first row anybody looks for.
    assert listing["current_known"] is True
    current = [item for item in listing["items"] if item["current"]]
    assert len(current) == 1, "exactly one session is the one making this request"
    assert current[0]["state"] == "ACTIVE"

    from src.models.identity import UserSession

    with session_scope() as session:
        row = session.scalar(select(UserSession).where(UserSession.token_id == sid))
        assert row is not None, "the request did not record its session"
        assert row.last_seen_at is not None


def test_only_one_session_is_ever_the_current_one(client, monkeypatch):
    from src.models.identity import UserSession

    # Two sign-ins from the same account, one after the other.
    first_headers, first_sid = _authenticate(monkeypatch)
    _sessions(client, first_headers)
    second_headers, second_sid = _authenticate(monkeypatch)
    listing = _sessions(client, second_headers)

    assert [item["current"] for item in listing["items"]].count(True) == 1
    # And the stored flag agrees, because the administrator's user drawer has
    # no request to derive it from.
    with session_scope() as session:
        rows = {
            row.token_id: row.is_current
            for row in session.scalars(
                select(UserSession).where(UserSession.token_id.in_((first_sid, second_sid)))
            )
        }
    assert rows[second_sid] is True
    assert rows[first_sid] is False


def test_the_current_session_is_derived_from_the_request_not_the_column(client, monkeypatch):
    from src.models.identity import UserSession

    headers, sid = _authenticate(monkeypatch)
    _sessions(client, headers)

    # The column lied — which is exactly what the seed did to every user.
    with session_scope() as session:
        for row in session.scalars(
            select(UserSession).where(UserSession.token_id == sid)
        ):
            row.is_current = False

    listing = _sessions(client, headers)
    current = [item for item in listing["items"] if item["current"]]
    # Still right, because `principal.session_id` is the authority for which
    # session *this request* came from.
    assert len(current) == 1


def test_the_last_seen_time_is_not_written_on_every_request(client, monkeypatch):
    from src.models.identity import UserSession

    headers, sid = _authenticate(monkeypatch)
    _sessions(client, headers)

    with session_scope() as session:
        first = session.scalar(
            select(UserSession.last_seen_at).where(UserSession.token_id == sid)
        )

    _sessions(client, headers)
    with session_scope() as session:
        second = session.scalar(
            select(UserSession.last_seen_at).where(UserSession.token_id == sid)
        )

    # A page making eight calls would otherwise be eight updates to one row
    # for one meaningful event. A minute is finer than any question this page
    # asks (see `SESSION_TOUCH_SECONDS`).
    assert first == second


def test_revoking_a_session_refuses_its_next_request(client, monkeypatch):
    """The claim the whole page rests on.

    Before this, nothing read `user_sessions` — so the button would have
    reported success and the device would have carried on working.
    """
    headers, _sid = _authenticate(monkeypatch)
    mine = _row(client, headers)

    answer = client.delete(f"{SECURITY}/sessions/{mine['id']}", headers=headers)
    assert answer.status_code == 200
    assert answer.get_json()["state"] == "REVOKED"

    # The *same* token, which is still cryptographically valid: what makes it
    # unacceptable is the row, which is the design the model claimed all along.
    after = client.get(f"{SECURITY}/sessions", headers=headers)
    assert after.status_code == 401
    assert "signed out" in after.get_json()["message"]


def test_a_revoked_session_cannot_reach_anything_at_all(client, monkeypatch):
    # Refused before a permission is consulted, so it is not a 403 about a
    # missing privilege but a 401 about an unacceptable credential.
    headers, _sid = _authenticate(monkeypatch, "manager", "manager")
    mine = _row(client, headers)
    client.delete(f"{SECURITY}/sessions/{mine['id']}", headers=headers)

    for url in (f"{PREFIX}/api/me", f"{PREFIX}/notifications", f"{SECURITY}/overview"):
        assert client.get(url, headers=headers).status_code == 401, url


def test_revoking_the_same_session_twice_says_so(client, monkeypatch):
    headers, _sid = _authenticate(monkeypatch)
    mine = _row(client, headers)
    client.delete(f"{SECURITY}/sessions/{mine['id']}", headers=headers)

    # A new sign-in, because the old one is refused now.
    headers, _sid = _authenticate(monkeypatch)
    again = client.delete(f"{SECURITY}/sessions/{mine['id']}", headers=headers)
    assert again.status_code == 409
    assert again.get_json()["details"]["state"] == "REVOKED"


def test_signing_out_everywhere_else_keeps_this_session(client, monkeypatch):
    from src.models.identity import UserSession

    # An older sign-in, then the one that sweeps.
    old_headers, old_sid = _authenticate(monkeypatch)
    _sessions(client, old_headers)
    headers, sid = _authenticate(monkeypatch)
    _sessions(client, headers)

    answer = client.post(f"{SECURITY}/sessions/revoke-others", headers=headers)
    assert answer.status_code == 200
    body = answer.get_json()
    assert body["revoked"] >= 1

    # This one still works — an operation that signed you out too would make
    # its own result impossible to look at.
    assert client.get(f"{SECURITY}/sessions", headers=headers).status_code == 200
    # And the other one does not.
    assert client.get(f"{SECURITY}/sessions", headers=old_headers).status_code == 401

    with session_scope() as session:
        kept = session.scalar(select(UserSession).where(UserSession.token_id == sid))
        gone = session.scalar(select(UserSession).where(UserSession.token_id == old_sid))
    assert kept.revoked_at is None
    assert gone.revoked_at is not None


def test_signing_out_everywhere_else_with_nowhere_else_is_not_an_error(client, monkeypatch):
    headers, _sid = _authenticate(monkeypatch, "user", "viewer")
    # Whatever the seed left this persona, sweeping twice must be safe: the
    # second call has nothing to do and should say so rather than fail.
    assert client.post(f"{SECURITY}/sessions/revoke-others", headers=headers).status_code == 200
    second = client.post(f"{SECURITY}/sessions/revoke-others", headers=headers)
    assert second.status_code == 200
    assert second.get_json()["revoked"] == 0


def test_an_expired_session_offers_nothing_to_revoke(client, monkeypatch):
    from datetime import timedelta

    from src.models.identity import UserSession

    headers, sid = _authenticate(monkeypatch)
    _sessions(client, headers)

    with session_scope() as session:
        row = session.scalar(select(UserSession).where(UserSession.token_id == sid))
        row.expires_at = now() - timedelta(hours=1)
        expired_id = str(row.id)

    listing = _sessions(client, headers)
    found = next(item for item in listing["items"] if item["id"] == expired_id)
    assert found["state"] == "EXPIRED"
    # Nothing to act on: revoking something time has already ended is a
    # button that changes nothing (§76).
    assert found["can_revoke"] is False
    assert client.delete(f"{SECURITY}/sessions/{expired_id}", headers=headers).status_code == 409
