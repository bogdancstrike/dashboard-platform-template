"""Real bytes for the seeded files (§20)."""

from __future__ import annotations

from src.core.facade import lazy

__getattr__, __dir__, __all__ = lazy(__name__, {
    "bodies": ("_INK", "_PAPER", "_AXIS", "_png", "_pdf", "_pdf_escape", "body_for"),
    "writing": ("_legacy_pixel", "materialise"),
})
