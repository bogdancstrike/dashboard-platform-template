"""Onboarding (§38): the checklist per role, and sample data per area."""

from __future__ import annotations

from typing import Any

from src.core.auth import authenticated, me, requires
from src.core.db import session_scope
from src.services import onboarding as service


@authenticated
def checklist(app=None, operation: str = "", request=None, **_: Any):
    """This person's checklist for their role, with progress."""
    with session_scope() as session:
        return service.checklist(session, principal=me()), 200


@authenticated
def step(app=None, operation: str = "", request=None, step_key=None, **_: Any):
    """Mark a step done or skipped, or back to to-do."""
    with session_scope() as session:
        return service.answer(session, str(step_key), request.get_json(silent=True) if request else None, principal=me()), 200


@authenticated
def dismiss(app=None, operation: str = "", request=None, **_: Any):
    """Hide or bring back the checklist card on Home."""
    with session_scope() as session:
        return service.dismiss(session, request.get_json(silent=True) if request else None, principal=me()), 200


@requires("admin.access")
def samples(app=None, operation: str = "", request=None, **_: Any):
    """Which areas have sample data loaded."""
    with session_scope() as session:
        return service.samples(session, principal=me()), 200


@requires("admin.access")
def sample(app=None, operation: str = "", request=None, area=None, **_: Any):
    """Load a tagged sample dataset for an area, or remove exactly what was loaded."""
    with session_scope() as session:
        if request is not None and request.method == "DELETE":
            return service.remove(session, str(area), principal=me()), 200
        return service.load(session, str(area), principal=me()), 201
