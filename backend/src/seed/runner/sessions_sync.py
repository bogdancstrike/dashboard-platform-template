"""Repairing sessions: one current, live session per person."""

from __future__ import annotations

from typing import Any


def sync_sessions(session) -> dict[str, int]:
    """Leave at most one current session per person, and only a live one (§41).

    `is_current` is derived from the *most recent live sign-in*, so this edits
    only a cached answer — the same justification `--sync-org` has for
    recounting a department's headcount. What it repairs: the seed marked the
    first five sessions of every user as current, so a person with three had
    three of them claiming to be the one they were using, and a revoked
    session could still be marked current.
    """
    from sqlalchemy import select as _select

    from src.core.clock import now
    from src.models.identity import UserSession

    moment = now()
    rows = _select(UserSession).where(UserSession.user_id.is_not(None))
    by_user: dict[Any, list[Any]] = {}
    for row in session.scalars(rows):
        by_user.setdefault(row.user_id, []).append(row)

    corrected = 0
    for sessions_of in by_user.values():
        live = [
            row
            for row in sessions_of
            if row.revoked_at is None and not (row.expires_at and row.expires_at <= moment)
        ]
        keeper = max(
            live,
            key=lambda row: row.last_seen_at or row.created_at,
            default=None,
        )
        for row in sessions_of:
            wanted = keeper is not None and row.id == keeper.id
            if row.is_current != wanted:
                row.is_current = wanted
                corrected += 1

    session.flush()
    return {"corrected": corrected, "people": len(by_user)}
