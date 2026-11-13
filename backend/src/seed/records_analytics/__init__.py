"""Records & analytics demo data (§12, §13, §17, §22, §25)."""

from __future__ import annotations

from src.core.facade import lazy

__getattr__, __dir__, __all__ = lazy(__name__, {
    "drop_notifications": (
        "SEED", "MARK", "DEMO_PASSWORD", "CONTRACT_TITLES", "SEGMENT_VALUE", "TERMS",
        "CHURN_REASONS", "WATCHES", "_persona", "_drop_notifications",
    ),
    "snapshots": ("_staff", "_audit", "_snapshots", "_EDITS", "_earlier"),
    "histories": ("_histories", "_watches"),
    "population": ("populate", "_contracts", "_links"),
    "safety": ("seed_safely",),
})
