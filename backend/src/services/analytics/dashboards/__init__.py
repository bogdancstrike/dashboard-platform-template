"""Saved dashboards (§2, §28): layouts of widgets, shared like any other saved thing.
See docs/architecture/backend/dashboards.md."""

from __future__ import annotations

from src.core.facade import lazy

__getattr__, __dir__, __all__ = lazy(__name__, {
    "widget_catalogue": (
        "KIND", "MANAGE_PERMISSION", "SHARE_PERMISSION", "WIDGET_KINDS", "MODULE_PERMISSIONS",
        "MODULE_KINDS", "MODULE_OPTIONS", "DATASET_KINDS", "REFERENCE_KINDS", "_offerable",
    ),
    "widget_sizes": (
        "COLUMNS", "MIN_HEIGHT", "MAX_HEIGHT", "MAX_WIDGETS_AT_ONCE", "DEFAULT_SIZES", "_TITLES",
        "_default_title",
    ),
    "layouts": ("listing", "get", "create", "update", "remove"),
    "copies": ("_requested_widgets", "duplicate", "_copy_name"),
    "widgets": ("add_widget", "update_widget", "remove_widget", "arrange"),
    "validation": ("_validated", "_validated_widget", "_geometry"),
    "widget_config": ("_config", "_module_options"),
    "serializers": (
        "_make_home", "_visible", "_owned", "_widget_of", "_slug", "_serialize", "_widget",
        "_state",
    ),
})
