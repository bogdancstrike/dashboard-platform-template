"""Contracts and the renewals pipeline (§13).
See docs/architecture/backend/contracts.md."""

from __future__ import annotations

from src.core.facade import lazy

__getattr__, __dir__, __all__ = lazy(__name__, {
    "fields": (
        "VIEW", "MANAGE", "STAGES", "STAGE_LABELS", "OPEN_STAGES", "CLOSED_STAGES",
        "DEFAULT_PROBABILITY", "BILLING", "CURRENCIES", "AT_RISK_BANDS", "FIELDS", "LABELS",
        "REQUIRED", "_ATTEMPTS", "coerce", "_value", "_check_dates", "_base", "_load",
    ),
    "serializers": ("state", "_bands", "_card", "_detail"),
    "pipeline": ("_filtered", "listing", "_summary", "board", "_quarter"),
    "forecasting": ("forecast", "calendar", "get", "load"),
    "changes": (
        "_next_reference", "create", "_rank_at_end", "_refuse_lost_race", "apply", "update",
        "move",
    ),
    "lifecycle": ("remove", "_rescore", "files", "ensure_folder", "_catch_up"),
})
