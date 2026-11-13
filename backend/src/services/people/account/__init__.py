"""The current user's platform profile and personal preferences (§40, §58).
See docs/architecture/backend/account.md."""

from __future__ import annotations

from src.core.facade import lazy

__getattr__, __dir__, __all__ = lazy(__name__, {
    "preference_vocabulary": ("PREFERENCE_DEFAULTS", "_CHOICES", "_FLAGS", "_SETS", "_TEXT"),
    "preference_checks": (
        "merged_preferences", "_validate_patch", "_named", "_choice_text", "_invalid",
    ),
    "profile_edit": (
        "get_profile", "update_preferences", "EDITABLE_FIELDS", "update_profile", "_user_model",
    ),
})
