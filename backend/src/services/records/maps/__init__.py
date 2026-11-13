"""Records on a map (§44, §61).
See docs/architecture/backend/maps.md."""

from __future__ import annotations

from src.core.facade import lazy

__getattr__, __dir__, __all__ = lazy(__name__, {
    "mappables": ("Metric", "Mappable", "_mappable", "catalogue"),
    "places_view": ("places", "_fold", "_metric", "_placed", "_city_of"),
})
