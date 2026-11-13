"""The checklist: read it, answer a step, dismiss it."""

from __future__ import annotations

from typing import Any

from sqlalchemy import select

from src.core.clock import iso, now
from src.core.errors import NotFoundError, ValidationError
from src.models.onboarding import OnboardingStep
from src.services.platform.onboarding.steps import (
    CARD_KEY,
    SAMPLE_PERMISSION,
    STATES,
    _steps_for,
)


def checklist(session, *, principal) -> dict[str, Any]:
    """This person's checklist, with progress — derived checks and own answers merged."""
    answers = {row.step_key: row for row in session.scalars(
        select(OnboardingStep).where(OnboardingStep.user_id == principal.user_id)).all()}
    steps = []
    for step in _steps_for(principal):
        answer = answers.get(step.key)
        auto = False
        if step.check is not None:
            try:
                with session.begin_nested():
                    auto = bool(step.check(session, principal.user_id))
            except Exception:  # noqa: BLE001 - a check that cannot run is just not done
                auto = False
        state = "done" if auto else (answer.status.lower() if answer else "todo")
        steps.append({
            "key": step.key, "title": step.title, "description": step.description, "to": step.to,
            "action": step.action, "state": state, "auto": auto, "automatic": step.check is not None,
            "completed_at": iso(answer.completed_at) if answer and not auto else None,
        })
    finished = sum(1 for step in steps if step["state"] in ("done", "skipped"))
    card = answers.get(CARD_KEY)
    return {
        "role": principal.role_code,
        "steps": steps,
        "progress": {"done": finished, "total": len(steps),
                     "percent": round(100 * finished / len(steps)) if steps else 100},
        "dismissed": bool(card and card.status == "DISMISSED"),
        "can_load_samples": principal.can(SAMPLE_PERMISSION),
    }


def answer(session, key: str, payload: dict[str, Any] | None, *, principal) -> dict[str, Any]:
    """Mark a step done or skipped — or back to to-do."""
    if key not in {step.key for step in _steps_for(principal)}:
        raise NotFoundError("That step is not on your checklist.")
    state = str((payload or {}).get("state") or "").upper()
    row = session.scalar(select(OnboardingStep).where(
        OnboardingStep.user_id == principal.user_id, OnboardingStep.step_key == key))
    if state == "TODO":
        if row is not None:
            session.delete(row)
    elif state in STATES:
        if row is None:
            row = OnboardingStep(user_id=principal.user_id, step_key=key, status=state)
            session.add(row)
        row.status = state
        row.completed_at = now()
    else:
        raise ValidationError("state must be done, skipped or todo.", details={"allowed": ["done", "skipped", "todo"]})
    session.flush()
    return checklist(session, principal=principal)


def dismiss(session, payload: dict[str, Any] | None, *, principal) -> dict[str, Any]:
    """Hide (or bring back) the checklist card on Home."""
    dismissed = bool((payload or {}).get("dismissed", True))
    row = session.scalar(select(OnboardingStep).where(
        OnboardingStep.user_id == principal.user_id, OnboardingStep.step_key == CARD_KEY))
    if dismissed and row is None:
        session.add(OnboardingStep(user_id=principal.user_id, step_key=CARD_KEY, status="DISMISSED", completed_at=now()))
    elif not dismissed and row is not None:
        session.delete(row)
    session.flush()
    return checklist(session, principal=principal)
