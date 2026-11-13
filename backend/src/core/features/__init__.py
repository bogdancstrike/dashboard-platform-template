"""Feature flags, enforced (§27).
See docs/architecture/backend/features.md."""

from __future__ import annotations

from src.core.facade import lazy

__getattr__, __dir__, __all__ = lazy(__name__, {
    "endpoints": (
        "DATASET", "LOCAL_TTL", "FeatureDisabledError", "_endpoint_entries", "_load_map", "_score",
        "owner_of", "endpoint_owners", "endpoints_of",
    ),
    "flag_cache": (
        "FlagState", "_lock", "_snapshot", "_snapshot_generation", "_snapshot_at", "_read_rows",
        "snapshot", "invalidate",
    ),
    "evaluation": (
        "_group_ids", "evaluate", "state_on", "_principal_context", "enabled_map", "is_enabled",
        "globally_enabled",
    ),
    "gate": (
        "require", "job_allowed", "live_allowed", "_rule_owner", "_public_rules", "install",
        "_refusal", "_caller",
    ),
    "live_socket": ("GatedSocket",),
})
