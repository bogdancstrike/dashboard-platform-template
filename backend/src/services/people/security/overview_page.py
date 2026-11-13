"""The security page's overview."""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from sqlalchemy import func, select

from src.core.clock import iso, now
from src.models.identity import LoginEvent, SecurityEvent
from src.services.people.security.sessions_view import (
    FAILURES_WORTH_SAYING,
    HISTORY_DAYS,
    sessions,
)


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
