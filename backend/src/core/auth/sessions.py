"""The session rows a request touches, and how it arrived (IP, agent, device)."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from flask import request

from src.core.errors import UnauthorizedError

#: How stale a session's `last_seen_at` may be before a request updates it.
#:
#: Every authenticated request could write the column, and on a page making
#: eight calls that is eight updates to one row for one meaningful event. A
#: minute is finer than any question the security page asks ("last seen 3
#: minutes ago") and coarse enough that the write is rare.
SESSION_TOUCH_SECONDS = 60


def touch_session(session, user, claims: dict[str, Any]) -> None:
    """Record this sign-in, and refuse it if it has been signed out (§41).

    `UserSession`'s own docstring has said since it was written that
    "revocation is a row update, so a revoked session is refused on its next
    request even though the JWT is still cryptographically valid until it
    expires". Nothing enforced it. Nothing *read* the table at all outside the
    administrator's user drawer — so `/settings/security` would have offered a
    "sign out this device" button that left the device signed in, which is
    worse than offering nothing: a security control that does nothing is one
    people rely on.

    Two halves, and both are needed for the page to be honest:

    **The session is recorded.** Keycloak's `sid` claim is the identity of a
    sign-in, so the row is upserted against it. Without this the page would
    list the seeded sessions and never the one the reader is looking at it
    from, which is the first row anybody looks for.

    **A revoked one is refused**, with a 401 rather than a 403: the credential
    is no longer acceptable, which is what 401 means, and it is what sends the
    browser back to sign in rather than showing a permissions message about a
    session that no longer exists.

    Done inside the session `principal_from_claims` already opened, so it
    costs one query and — at most once a minute per session — one update.
    """
    from src.core.clock import now
    from src.models.identity import UserSession

    token_id = str(claims.get("sid") or "")
    if not token_id:
        # A token with no session claim cannot be tracked or revoked. Allowed
        # rather than refused, because a machine-to-machine credential is
        # legitimately sessionless — and recorded nowhere rather than recorded
        # wrongly.
        return

    from sqlalchemy import select

    row = session.scalar(select(UserSession).where(UserSession.token_id == token_id))
    moment = now()

    if row is not None and row.revoked_at is not None:
        raise UnauthorizedError(
            "This session was signed out. Sign in again.",
            details={"session": token_id, "revoked_at": row.revoked_at.isoformat()},
        )

    fingerprint = session_fingerprint()
    expires = claims.get("exp")

    if row is None:
        session.add(
            UserSession(
                user_id=user.id,
                token_id=token_id,
                ip_address=fingerprint["ip_address"],
                user_agent=fingerprint["user_agent"],
                device=fingerprint["device"],
                is_current=True,
                last_seen_at=moment,
                expires_at=(
                    datetime.fromtimestamp(float(expires), tz=UTC)
                    if isinstance(expires, (int, float))
                    else None
                ),
            )
        )
        only_current(session, user_id=user.id, token_id=token_id)
        return

    # Written at most once a minute: see `SESSION_TOUCH_SECONDS`.
    stale = (
        row.last_seen_at is None
        or (moment - row.last_seen_at).total_seconds() > SESSION_TOUCH_SECONDS
    )
    if stale:
        row.last_seen_at = moment
        row.ip_address = fingerprint["ip_address"]
        row.device = fingerprint["device"]
    if not row.is_current:
        row.is_current = True
        only_current(session, user_id=user.id, token_id=token_id)


def only_current(session, *, user_id, token_id: str) -> None:
    """One session per person may be the current one.

    Which is what the word means, and what the seed did not do: it marked the
    first five sessions of *every* user as current, so a person with three
    sessions had three of them claiming to be the one they were using.
    """
    from sqlalchemy import update

    from src.models.identity import UserSession

    session.execute(
        update(UserSession)
        .where(
            UserSession.user_id == user_id,
            UserSession.token_id != token_id,
            UserSession.is_current.is_(True),
        )
        .values(is_current=False)
    )


def session_fingerprint() -> dict[str, str]:
    """What gets recorded on a session/audit row about *how* a call arrived."""
    agent = request.headers.get("User-Agent", "")
    forwarded = request.headers.get("X-Forwarded-For", "")
    ip = (forwarded.split(",")[0].strip() if forwarded else request.remote_addr) or "0.0.0.0"
    return {"ip_address": ip, "user_agent": agent[:400], "device": device_of(agent)}


def device_of(agent: str) -> str:
    """What kind of thing a user agent is, in a word a person reads.

    Public because the seed needs the same answer: it had its own copy, so a
    seeded session and a real one could disagree about what "Edge" is, and the
    two would have drifted the first time either was extended.
    """
    lowered = agent.lower()
    if "iphone" in lowered or "android" in lowered:
        return "Mobile"
    if "ipad" in lowered or "tablet" in lowered:
        return "Tablet"
    if "curl" in lowered or "python" in lowered or "postman" in lowered:
        return "API client"
    for name, label in (
        ("edg", "Edge"), ("chrome", "Chrome"), ("firefox", "Firefox"), ("safari", "Safari")
    ):
        if name in lowered:
            return label
    return "Unknown"
