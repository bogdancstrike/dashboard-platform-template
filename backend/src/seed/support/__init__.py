"""Deterministic randomness, and the small helpers every builder needs."""

from __future__ import annotations

from src.core.facade import lazy

__getattr__, __dir__, __all__ = lazy(__name__, {
    "rng": ("T", "_SLUG_STRIP", "Rng", "slugify", "initials_of"),
    "formatting": ("reference", "avatar_data_uri", "checksum_of", "mask_hash"),
})
