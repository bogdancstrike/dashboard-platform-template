"""The data catalogue (§65, §71) — what the platform holds, and how good it is.
See docs/architecture/backend/catalog.md."""

from __future__ import annotations

from src.core.facade import lazy

__getattr__, __dir__, __all__ = lazy(__name__, {
    "datasets": (
        "PROFILE_TTL", "SPARSE_BELOW", "STALE_AFTER_DAYS", "catalogue", "dataset", "_profile",
        "_field_entry", "_operators", "_notes",
    ),
    "samples": ("sample",),
})
