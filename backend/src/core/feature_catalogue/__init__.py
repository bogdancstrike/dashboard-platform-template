"""The feature catalogue — every switchable feature, and everything it controls (§27).
See docs/architecture/backend/feature-catalogue.md."""

from __future__ import annotations

from src.core.facade import lazy

__getattr__, __dir__, __all__ = lazy(__name__, {
    "model": ("Feature", "AREAS"),
    "catalogue": ("ENTITY_GRIDS", "FEATURES"),
    "index": ("RETIRED", "CORE_ENDPOINTS", "FEATURES_BY_KEY"),
})
