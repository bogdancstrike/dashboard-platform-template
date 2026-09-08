"""The reader's own security page (§41): sessions, sign-ins, and what to worry about.

Three tables, one subject: **you**. Every query here is scoped to
`principal.user_id` and there is no permission to hold, because being signed in
is the qualification for seeing your own sessions. That is not laxity — it is
the point. A security page that needed granting would be one most people never
see, and the whole value of this one is that the person whose account it is can
look at it without asking anybody.

Five decisions worth the reader's attention.

**Revoking a session actually revokes it.** `UserSession`'s docstring had said
since it was written that a revoked session is refused on its next request —
and nothing read the table at all. So this page would have offered a "sign out
this device" button that left the device signed in, which is worse than
offering nothing: a control that does nothing is one people rely on.
`core/auth._touch_session` is the other half, and it is where the guarantee
lives; this is only the button.

**"Current" is derived from the request, not read from a column.** Which
session you are looking at the page *from* is a fact about this request, and
`principal.session_id` is the authority. The stored `is_current` is maintained
too — the administrator's user drawer has no request to derive it from, so for
them it means "the session that most recently made a request" — but this page
never trusts it. The seed marked the first five sessions of every user as
current, so a person with three had three of them claiming to be the one they
were using.

**A failed sign-in is the most important row on the page**, and it is the one a
naive implementation drops. `LoginEvent` records failures with a reason, and
somebody trying your password from an address you do not recognise is exactly
what this page exists to show — so failures are counted separately, surfaced
first, and never merged into a "recent activity" list where they read as
ordinary.

**Nothing here can be deleted.** A session is revoked, an event is resolved,
and the sign-in history is a record. A security page whose rows can be tidied
away is one an attacker tidies away.

**You cannot revoke the session you are using by accident.** It is offered —
signing yourself out is a reasonable thing to want — but it is a distinct
action with its own confirmation, because pressing "revoke" down a list and
landing on your own row is how somebody loses their work.
"""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from sqlalchemy import Select, func, select

from src.core import audit, vocabulary
from src.core.clock import iso, now
from src.core.errors import ConflictError, NotFoundError
from src.core.pagination import envelope, parse_page, parse_uuid
from src.core.query import Field, FieldSet, apply_filters, apply_sort, count_of, facets_for
from src.models.identity import LoginEvent, SecurityEvent, UserSession

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


# ── sessions ─────────────────────────────────────────────────────────────


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


def trust(session, ident: Any, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    """Mark a device as one you recognise, or stop doing so.

    A note to yourself rather than a grant: nothing in the platform treats a
    trusted session differently, and saying so is the honest version. What it
    buys is the ability to scan the list and see the one you *do not*
    recognise, which is the whole reason somebody opens this page.
    """
    row = _own_session(session, ident, principal=principal)
    wanted = bool((payload or {}).get("trusted", True))

    if row.trusted != wanted:
        row.trusted = wanted
        audit.record(
            session,
            action="session.trust" if wanted else "session.untrust",
            resource_type="session",
            resource_id=row.id,
            resource_label=row.device or "session",
            principal=principal,
            after={"trusted": wanted},
        )
    session.commit()
    return _session(row, principal=principal)


def _own_session(session, ident: Any, *, principal) -> UserSession:
    """One of my sessions, or a 404 that does not say whose it was."""
    row = session.get(UserSession, parse_uuid(ident, field="session id"))
    if row is None or row.user_id != principal.user_id:
        raise NotFoundError("That session does not exist.", details={"id": str(ident)})
    return row


# ── sign-in history ──────────────────────────────────────────────────────


def _history_fields() -> FieldSet:
    return FieldSet(
        Field("result", LoginEvent.result, kind="enum", label="Result", facet=True),
        Field("method", LoginEvent.method, kind="enum", label="Method", facet=True),
        Field("device", LoginEvent.device, kind="enum", label="Device", facet=True),
        Field("ip_address", LoginEvent.ip_address, label="Address", searchable=True),
        Field("created_at", LoginEvent.created_at, kind="datetime", label="When"),
    )


def history(session, args, *, principal) -> dict[str, Any]:
    """This account's recent sign-ins, successes and failures alike.

    Filtered and faceted in PostgreSQL, so "show me only the failures" is a
    query rather than a narrowing of the page in hand (§71).
    """
    fields = _history_fields()
    page = parse_page(args, default_sort="created_at")
    since = now() - timedelta(days=HISTORY_DAYS)

    statement = apply_filters(
        select(LoginEvent).where(
            LoginEvent.user_id == principal.user_id, LoginEvent.created_at >= since
        ),
        args,
        fields,
    )
    total = count_of(session, statement)
    facets = facets_for(session, statement, fields)
    statement = apply_sort(statement, page, fields, default="created_at")
    rows = session.scalars(statement.offset(page.offset).limit(page.page_size)).all()

    return envelope(
        [
            {
                "id": str(row.id),
                "result": row.result,
                "reason": row.reason,
                "method": row.method,
                "device": row.device or "Unknown",
                "ip_address": row.ip_address,
                "location": row.location,
                "at": iso(row.created_at),
            }
            for row in rows
        ],
        total,
        page,
        facets=facets,
        fields=fields.describe(),
        window_days=HISTORY_DAYS,
    )


# ── security events ──────────────────────────────────────────────────────


def events(session, args, *, principal) -> dict[str, Any]:
    """What the platform has noticed about this account."""
    fields = FieldSet(
        Field("kind", SecurityEvent.kind, kind="enum", label="Kind", facet=True),
        Field("severity", SecurityEvent.severity, kind="enum", label="Severity", facet=True,
              choices=vocabulary.SECURITY_SEVERITY),
        Field("resolved", SecurityEvent.resolved, kind="bool", label="Resolved", facet=True),
        Field("title", SecurityEvent.title, label="What", searchable=True),
        Field("created_at", SecurityEvent.created_at, kind="datetime", label="When"),
    )
    page = parse_page(args, default_sort="created_at")

    statement = apply_filters(
        select(SecurityEvent).where(SecurityEvent.user_id == principal.user_id), args, fields
    )
    total = count_of(session, statement)
    facets = facets_for(session, statement, fields)
    statement = apply_sort(statement, page, fields, default="created_at")
    rows = session.scalars(statement.offset(page.offset).limit(page.page_size)).all()

    return envelope(
        [_event(row) for row in rows],
        total,
        page,
        facets=facets,
        fields=fields.describe(),
    )


def _event(row) -> dict[str, Any]:
    return {
        "id": str(row.id),
        "kind": row.kind,
        "severity": row.severity,
        "title": row.title,
        "description": row.description,
        "ip_address": row.ip_address,
        "resolved": row.resolved,
        "at": iso(row.created_at),
        "details": dict(row.metadata_json or {}),
    }


def resolve(session, ident: Any, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    """Mark an event as dealt with — or as not, if it was pressed by mistake.

    Reversible, and *not* a delete. "I have seen this and it was me" is the
    common case and worth being able to record; losing the row would leave the
    page unable to answer "was this ever looked at".
    """
    row = session.get(SecurityEvent, parse_uuid(ident, field="event id"))
    if row is None or row.user_id != principal.user_id:
        raise NotFoundError("That event does not exist.", details={"id": str(ident)})

    wanted = bool((payload or {}).get("resolved", True))
    if row.resolved != wanted:
        row.resolved = wanted
        audit.record(
            session,
            action="security_event.resolve" if wanted else "security_event.reopen",
            resource_type="security_event",
            resource_id=row.id,
            resource_label=row.title,
            principal=principal,
            after={"resolved": wanted},
        )
    session.commit()
    return _event(row)


# ── the page's own summary ───────────────────────────────────────────────


def overview(session, *, principal) -> dict[str, Any]:
    """The three things worth knowing before scrolling.

    A summary rather than a set of counts: the page's job is to answer "is
    anything wrong" in one glance, and a row of numbers makes a reader do the
    arithmetic themselves.
    """
    since = now() - timedelta(days=HISTORY_DAYS)

    failures = (
        session.scalar(
            select(func.count())
            .select_from(LoginEvent)
            .where(
                LoginEvent.user_id == principal.user_id,
                LoginEvent.created_at >= since,
                LoginEvent.result != "SUCCESS",
            )
        )
        or 0
    )
    unresolved = (
        session.scalar(
            select(func.count())
            .select_from(SecurityEvent)
            .where(
                SecurityEvent.user_id == principal.user_id,
                SecurityEvent.resolved.is_(False),
            )
        )
        or 0
    )
    live = sessions(session, principal=principal)
    last_success = session.scalar(
        select(LoginEvent)
        .where(LoginEvent.user_id == principal.user_id, LoginEvent.result == "SUCCESS")
        .order_by(LoginEvent.created_at.desc())
        .limit(1)
    )
    addresses = [
        row[0]
        for row in session.execute(
            select(LoginEvent.ip_address)
            .where(
                LoginEvent.user_id == principal.user_id,
                LoginEvent.created_at >= since,
                LoginEvent.result != "SUCCESS",
                LoginEvent.ip_address.is_not(None),
            )
            .group_by(LoginEvent.ip_address)
            .order_by(func.count().desc())
            .limit(5)
        ).all()
    ]

    return {
        "window_days": HISTORY_DAYS,
        "active_sessions": live["active"],
        "other_sessions": live["others"],
        "current_known": live["current_known"],
        "failed_sign_ins": failures,
        # The one number that earns a sentence at the top of the page.
        "failures_worth_saying": failures >= FAILURES_WORTH_SAYING,
        "failure_addresses": addresses,
        "unresolved_events": unresolved,
        "last_signed_in_at": iso(last_success.created_at) if last_success else None,
        "last_signed_in_from": last_success.ip_address if last_success else None,
        "last_signed_in_on": (last_success.device or "Unknown") if last_success else None,
    }
