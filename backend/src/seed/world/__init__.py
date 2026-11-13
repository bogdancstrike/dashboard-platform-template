"""The dataset under construction, and how big it is."""

from __future__ import annotations

from src.core.facade import lazy

__getattr__, __dir__, __all__ = lazy(__name__, {
    "scale": ("Scale", "FULL", "SMALL", "SCALES"),
    "world": ("World",),
})
