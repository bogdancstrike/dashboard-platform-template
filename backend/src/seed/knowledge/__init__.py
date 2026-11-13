"""Seeded document collections for "Ask your documents" (§44)."""

from __future__ import annotations

from src.core.facade import lazy

__getattr__, __dir__, __all__ = lazy(__name__, {
    "doc": (
        "PAGE_W", "PAGE_H", "MARGIN", "BODY_W", "Doc", "HANDBOOK", "SECURITY", "PLAYBOOK",
        "RELEASE", "ONBOARDING_MD",
    ),
    "rendering": ("COLLECTIONS", "QUESTIONS", "render", "_questions"),
    "seeding": ("seed", "seed_safely"),
})
