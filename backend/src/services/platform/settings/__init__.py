"""System settings and feature flags (§11, §27).
See docs/architecture/backend/settings.md."""

from __future__ import annotations

from src.core.facade import lazy

__getattr__, __dir__, __all__ = lazy(__name__, {
    "system_settings": (
        "SETTINGS_PERMISSION", "FLAGS_PERMISSION", "VALUE_TYPES", "MAX_KEY", "MAX_LABEL",
        "settings", "_categories", "update_setting",
    ),
    "values": ("REDACTED", "_coerced", "_visible", "_raw", "_drifted", "_setting"),
    "flag_list": ("flags", "_flag_row", "update_flag"),
    "flag_lifecycle": ("create_flag", "remove_flag", "flag_history", "preview"),
    "flag_state": (
        "enabled_for", "is_on", "_flag", "_controls", "_flag_state", "_strings", "_codes",
    ),
})
