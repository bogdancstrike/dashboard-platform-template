"""Onboarding demo data (§38): the personas part-way through their checklists.

Idempotent, so it is also `--sync-onboarding`. Only *answers* are seeded — a
skipped step here, a manually ticked one there; the steps that tick themselves
off are derived from what the seeded data shows each persona has done, so the
checklist is honest from the first sign-in.
"""

from __future__ import annotations

from datetime import timedelta

from sqlalchemy import select

from src.core.clock import now

ANSWERS = {
    "admin": {"tour": "DONE", "integration": "SKIPPED"},
    "manager": {"tour": "DONE"},
    "operator": {"favorite": "DONE"},
    "analyst": {"tour": "SKIPPED"},
}


def populate(session) -> dict[str, int]:
    from src.models.identity import User
    from src.models.onboarding import OnboardingStep

    added = 0
    for username, answers in ANSWERS.items():
        user = session.scalar(select(User).where(User.username == username))
        if user is None:
            continue
        have = set(session.scalars(select(OnboardingStep.step_key).where(OnboardingStep.user_id == user.id)).all())
        for index, (key, status) in enumerate(answers.items()):
            if key in have:
                continue
            session.add(OnboardingStep(user_id=user.id, step_key=key, status=status,
                                       completed_at=now() - timedelta(days=index + 1)))
            added += 1
    session.flush()
    return {"answers": added}
