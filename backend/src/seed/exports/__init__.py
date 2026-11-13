"""Real files for the seeded exports (§30)."""

from __future__ import annotations

from src.core.facade import lazy

__getattr__, __dir__, __all__ = lazy(__name__, {
    "recount": (
        "_LEGACY_ENTITY", "GUARANTEED_DOWNLOADABLE", "_next_reference", "_plan_of", "_recount",
        "_rename",
    ),
    "guarantee": ("_guarantee",),
    "writing": ("materialise",),
})
