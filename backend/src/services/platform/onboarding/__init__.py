"""Onboarding (§38): a checklist per role, empty-state guides, and sample data.
See docs/architecture/backend/onboarding.md."""

from __future__ import annotations

from src.core.facade import lazy

__getattr__, __dir__, __all__ = lazy(__name__, {
    "steps": (
        "SAMPLE_PERMISSION", "CARD_KEY", "STATES", "Step", "_audited", "_owns", "_any", "_profile",
        "_published_workflow", "S", "ROLES", "_steps_for",
    ),
    "checklist_view": ("checklist", "answer", "dismiss"),
    "sample_data": (
        "CUSTOMERS", "PROJECTS", "TASKS", "TICKETS", "DEVICES", "AREAS", "_payloads", "samples",
        "load", "remove", "_referenced",
    ),
})
