"""The reader's sessions: list, revoke, revoke the others."""

from __future__ import annotations

from typing import Any

from sqlalchemy import Select, select

from src.core import audit
from src.core.clock import iso, now
from src.core.errors import ConflictError, NotFoundError
from src.core.pagination import parse_uuid
from src.models.identity import UserSession

#: How far back the sign-in history reaches on this page.
#:
#: Not a retention policy — nothing is deleted — but a window: "have there been
#: failed sign-ins" is a question about the recent past, and a list going back
#: two years buries this week's under four hundred rows.
HISTORY_DAYS = 90


#: How many failures in the window before the page leads with them.
#:
#: One failed sign-in is a typo. Three from an address you do not recognise is
#: worth a sentence at the top of the page rather than a row two scrolls down.
FAILURES_WORTH_SAYING = 3


def _mine(principal) -> Select:
    return select(UserSession).where(UserSession.user_id == principal.user_id)


def expired(row) -> bool:
    """Whether the token behind this session has run out.

    Derived, because `expires_at` is a moment and "expired" is a comparison —
    and a session that has quietly expired is *not* the same as one somebody
    signed out, which is the distinction the page has to draw.
    """
    return bool(row.expires_at and row.expires_at <= now())


def state(row) -> str:
    """What one session is, in one word.

    Three outcomes and they are not interchangeable: `REVOKED` is somebody's
    decision, `EXPIRED` is time passing, `ACTIVE` is a live sign-in. A page
    showing "inactive" for the first two would be hiding the only one anybody
    acted on.
    """
    if row.revoked_at is not None:
        return "REVOKED"
    if expired(row):
        return "EXPIRED"
    return "ACTIVE"


def _session(row, *, principal) -> dict[str, Any]:
    """One session as the reader sees it."""
    situation = state(row)
    return {
        "id": str(row.id),
        # Never the token id itself: it is the identity of a live credential,
        # and a page that printed it would put it in a screenshot (§76).
        "device": row.device or "Unknown",
        "user_agent": row.user_agent,
        "ip_address": row.ip_address,
        "location": row.location,
        "state": situation,
        # Derived from *this request*, not from the stored column: which
        # session you are reading the page from is a fact about the request.
        "current": bool(principal.session_id) and row.token_id == principal.session_id,
        "trusted": row.trusted,
        "signed_in_at": iso(row.created_at),
        "last_seen_at": iso(row.last_seen_at),
        "expires_at": iso(row.expires_at),
        "revoked_at": iso(row.revoked_at),
        # A live session is the only one there is anything to do about.
        "can_revoke": situation == "ACTIVE",
    }


def sessions(session, *, principal) -> dict[str, Any]:
    """Every sign-in on this account, the live ones first."""
    rows = session.scalars(
        _mine(principal).order_by(
            UserSession.revoked_at.is_(None).desc(),
            UserSession.last_seen_at.desc().nullslast(),
        )
    ).all()

    listed = [_session(row, principal=principal) for row in rows]
    return {
        "items": listed,
        "total": len(listed),
        "active": sum(1 for item in listed if item["state"] == "ACTIVE"),
        # Whether the page can say "you are signed in on three other devices",
        # which is the sentence somebody scans for.
        "others": sum(
            1 for item in listed if item["state"] == "ACTIVE" and not item["current"]
        ),
        # Said out loud, because a page listing sessions with no "this is the
        # one you are using" is a page nobody can act on safely. Empty when
        # the token carried no session claim — a machine credential.
        "current_known": bool(principal.session_id),
    }


def revoke(session, ident: Any, *, principal) -> dict[str, Any]:
    """Sign one device out. The button the enforcement makes real.

    Refuses the one you are using unless it is asked for by name — see
    `revoke_others` for the sweep, and the module note for why.
    """
    row = _own_session(session, ident, principal=principal)

    if state(row) != "ACTIVE":
        raise ConflictError(
            f"That session is already {state(row).lower()}.",
            details={"state": state(row)},
        )

    row.revoked_at = now()
    row.is_current = False
    audit.record(
        session,
        action="session.revoke",
        resource_type="session",
        resource_id=row.id,
        resource_label=row.device or "session",
        principal=principal,
        # The device and where from, never the token: an audit row carrying a
        # session id would be a credential in the ledger.
        before={"device": row.device, "ip_address": row.ip_address},
        metadata={
            "self": bool(principal.session_id) and row.token_id == principal.session_id
        },
    )
    session.commit()
    return _session(row, principal=principal)


def revoke_others(session, *, principal) -> dict[str, Any]:
    """Sign out everywhere else, keeping this one.

    The action somebody takes when they think their password is known, and the
    reason it excludes the current session is practical rather than cautious:
    an operation that signed you out too would make its own result impossible
    to look at.
    """
    rows = [
        row
        for row in session.scalars(_mine(principal).where(UserSession.revoked_at.is_(None)))
        if state(row) == "ACTIVE" and row.token_id != principal.session_id
    ]

    moment = now()
    for row in rows:
        row.revoked_at = moment
        row.is_current = False

    if rows:
        audit.record(
            session,
            action="session.revoke_others",
            resource_type="session",
            resource_id=principal.user_id,
            resource_label=f"{len(rows)} sessions",
            principal=principal,
            after={"revoked": len(rows), "devices": sorted({row.device or "" for row in rows})},
        )
    session.commit()
    return {"revoked": len(rows), **sessions(session, principal=principal)}


def _own_session(session, ident: Any, *, principal) -> UserSession:
    """One of my sessions, or a 404 that does not say whose it was."""
    row = session.get(UserSession, parse_uuid(ident, field="session id"))
    if row is None or row.user_id != principal.user_id:
        raise NotFoundError("That session does not exist.", details={"id": str(ident)})
    return row
