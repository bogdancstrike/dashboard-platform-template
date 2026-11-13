"""Seed data for decisions: RNG_SEED, NOTES, _personas."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import select

RNG_SEED = 20261112


NOTES = (
    "Pairing on the fix", "Customer call", "Reviewed the pull request", "Investigated logs",
    "Wrote the runbook", "Planning with the team", "Reproduced the issue", "Deployed to staging",
    "Followed up by email", "Load testing", "Data clean-up", "Design review", "",
    "", "",
)


def _personas(session) -> dict[str, Any]:
    from src.models.identity import User
    from src.seed.identity import PERSONA_DOMAIN, PERSONAS

    found = {}
    for username, *_rest in PERSONAS:
        user = session.scalars(select(User).where(User.email == f"{username}@{PERSONA_DOMAIN}")).first()
        if user is not None:
            found[username] = user
    return found


def _system(session, user):
    """A principal for writes the seed makes on somebody's behalf."""
    from src.core.auth import ALL_PERMISSIONS, Principal

    return Principal(user_id=user.id, subject="", email=user.email, username=user.username,
                     full_name=user.full_name, role_code="ADMINISTRATOR",
                     permissions=frozenset(ALL_PERMISSIONS))


def _decide(row, person, status: str, comment: str, at: datetime) -> None:
    from src.services.decisions.approvals import _event

    row.status = status
    row.decided_at = at
    row.decided_by_id = person.id
    row.decision_comment = comment
    row.history = [*(row.history or []), _event(status, actor_id=person.id, actor_label=person.full_name,
                                                comment=comment, at=at)]
