"""The reader's own security page (§41): sessions, sign-ins, and enforcement.

Four claims this module exists for.

**Revoking a session actually revokes it.** `UserSession`'s docstring had said
since it was written that a revoked session is refused on its next request, and
nothing read the table at all — so the page would have offered a "sign out this
device" button that left the device signed in. That is worse than offering
nothing, because a control that does nothing is one people rely on. The test
signs in, revokes, and asks again with the *same* token: 401.

**The session you are using is recorded.** Without that, the page lists the
seeded sessions and never the one the reader is looking at it from, which is
the first row anybody looks for.

**"Current" is one session, derived from the request.** The seed marked the
first five sessions of every user as current, so somebody with three had three
of them claiming to be the one they were using — and this page derives it from
`principal.session_id` rather than trusting the column at all.

**Somebody else's sessions are not visible, and there is no permission to
hold.** Being signed in is the qualification for seeing your own; a viewer with
no privileges at all must reach this page, and must reach only their own rows.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select

from src.config import Config
from src.core.clock import now
from src.core.db import session_scope
from src.services import security as service
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

    monkeypatch.setattr("src.core.auth.verify_token", verify)
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


# ── the state of one session ────────────────────────────────────────────


class _Session:
    """Only the three fields `state` reads."""

    def __init__(self, revoked_at=None, expires_at=None):
        self.revoked_at = revoked_at
        self.expires_at = expires_at


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


# ── the session you are using ───────────────────────────────────────────


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


# ── revocation, and the enforcement behind it ───────────────────────────


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


# ── trust ───────────────────────────────────────────────────────────────


def test_a_device_can_be_marked_recognised_and_unmarked(client, monkeypatch):
    headers, _sid = _authenticate(monkeypatch)
    mine = _row(client, headers)

    marked = client.put(
        f"{SECURITY}/sessions/{mine['id']}", json={"trusted": True}, headers=headers
    )
    assert marked.status_code == 200
    assert marked.get_json()["trusted"] is True

    unmarked = client.put(
        f"{SECURITY}/sessions/{mine['id']}", json={"trusted": False}, headers=headers
    )
    assert unmarked.get_json()["trusted"] is False


# ── sign-in history ────────────────────────────────────────────────────


def test_the_history_shows_failures_as_well_as_successes(client, monkeypatch):
    headers, _sid = _authenticate(monkeypatch, "admin", "administrator")
    body = client.get(f"{SECURITY}/sign-ins?page_size=100", headers=headers).get_json()

    assert body["window_days"] == service.HISTORY_DAYS
    results = {item["result"] for item in body["items"]}
    # A failed sign-in is what somebody opens this page to look for, so it
    # must not be filtered out of the list it belongs in.
    assert results, "the seed left this persona no sign-in history"
    assert results <= {"SUCCESS", "FAILURE"}


def test_the_history_can_be_narrowed_to_the_failures_in_sql(client, monkeypatch):
    made = _failed_sign_in("analyst")
    headers, _sid = _authenticate(monkeypatch, "analyst", "analyst")
    whole = client.get(f"{SECURITY}/sign-ins?page_size=200", headers=headers).get_json()
    failures = client.get(
        f"{SECURITY}/sign-ins?result=FAILURE&page_size=200", headers=headers
    ).get_json()

    assert failures["total"] >= 1
    assert failures["total"] <= whole["total"]
    # Narrowed by PostgreSQL, not by the page: the total moves with the filter
    # rather than only the rows on screen (§71).
    assert {item["result"] for item in failures["items"]} == {"FAILURE"}
    assert made in {item["id"] for item in failures["items"]}
    # And the reason, which is the difference between "somebody tried your
    # password" and "your session expired".
    mine = next(item for item in failures["items"] if item["id"] == made)
    assert mine["reason"] == "Wrong password"
    assert mine["ip_address"] == "203.0.113.9"


def test_the_history_is_mine_and_only_mine(client, monkeypatch):
    headers, _sid = _authenticate(monkeypatch, "analyst", "analyst")
    mine = client.get(f"{SECURITY}/sign-ins?page_size=200", headers=headers).get_json()

    from src.models.identity import LoginEvent, User

    with session_scope() as session:
        me = session.scalar(select(User).where(User.username == "analyst"))
        theirs = {
            str(row.id)
            for row in session.scalars(
                select(LoginEvent).where(LoginEvent.user_id != me.id).limit(50)
            )
        }
    assert theirs, "the seed has no other people's sign-ins to leak"
    assert not ({item["id"] for item in mine["items"]} & theirs)


# ── security events ────────────────────────────────────────────────────


def test_an_event_can_be_resolved_and_reopened(client, monkeypatch):
    made = _security_event("analyst")
    headers, _sid = _authenticate(monkeypatch, "analyst", "analyst")
    listing = client.get(f"{SECURITY}/events?page_size=100", headers=headers).get_json()
    first = next(item for item in listing["items"] if item["id"] == made)
    assert first["resolved"] is False

    resolved = client.put(
        f"{SECURITY}/events/{first['id']}", json={"resolved": True}, headers=headers
    )
    assert resolved.status_code == 200
    assert resolved.get_json()["resolved"] is True

    # Reversible, and not a delete: "I have seen this and it was me" is worth
    # recording, and losing the row would leave the page unable to say whether
    # anything was ever looked at.
    reopened = client.put(
        f"{SECURITY}/events/{first['id']}", json={"resolved": False}, headers=headers
    )
    assert reopened.get_json()["resolved"] is False


def test_every_seeded_event_severity_is_one_the_page_can_colour():
    from src.core import vocabulary
    from src.models.identity import SecurityEvent

    with session_scope() as session:
        found = {
            row[0] for row in session.execute(select(SecurityEvent.severity).distinct()).all()
        }
    assert found, "run `make seed`; there are no security events"
    # Declared in `core/vocabulary` rather than spelled in the seed: a
    # severity only the seed knows about is one the page renders with no
    # colour and no label.
    assert found <= set(vocabulary.SECURITY_SEVERITY)


def test_somebody_elses_event_cannot_be_resolved(client, monkeypatch):
    from src.models.identity import SecurityEvent, User

    headers, _sid = _authenticate(monkeypatch, "analyst", "analyst")
    with session_scope() as session:
        me = session.scalar(select(User).where(User.username == "analyst"))
        theirs = session.scalar(
            select(SecurityEvent).where(SecurityEvent.user_id != me.id).limit(1)
        )
    assert theirs is not None, "the seed has no other people's events"

    # 404 rather than 403: the reply must not confirm the event exists.
    answer = client.put(
        f"{SECURITY}/events/{theirs.id}", json={"resolved": True}, headers=headers
    )
    assert answer.status_code == 404


# ── the summary ────────────────────────────────────────────────────────


def test_the_overview_answers_is_anything_wrong(client, monkeypatch):
    headers, _sid = _authenticate(monkeypatch, "admin", "administrator")
    body = client.get(f"{SECURITY}/overview", headers=headers).get_json()

    assert body["window_days"] == service.HISTORY_DAYS
    assert body["active_sessions"] >= 1, "the request's own session is one"
    assert body["current_known"] is True
    # The one number that earns a sentence at the top of the page, derived
    # rather than left to the reader's arithmetic.
    assert body["failures_worth_saying"] is (
        body["failed_sign_ins"] >= service.FAILURES_WORTH_SAYING
    )


def test_the_overview_counts_only_this_account(client, monkeypatch):
    headers, _sid = _authenticate(monkeypatch, "analyst", "analyst")
    mine = client.get(f"{SECURITY}/overview", headers=headers).get_json()

    from src.models.identity import LoginEvent

    with session_scope() as session:
        everyone = session.scalar(
            select(__import__("sqlalchemy").func.count())
            .select_from(LoginEvent)
            .where(LoginEvent.result != "SUCCESS")
        )
    assert everyone > mine["failed_sign_ins"], "the count is not scoped to this account"


# ── who may see it ─────────────────────────────────────────────────────


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


# ── the record it leaves ───────────────────────────────────────────────


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
