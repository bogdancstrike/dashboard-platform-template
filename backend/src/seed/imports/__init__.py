"""Making the seeded import runs describe files that could exist (§29)."""

from __future__ import annotations

from src.core.facade import lazy

__getattr__, __dir__, __all__ = lazy(__name__, {
    "repair_counts": ("_snapshot", "_repair_rows", "_repair_counts", "_errors_are_readable"),
    "writing": ("materialise", "_repair_mapping"),
})
