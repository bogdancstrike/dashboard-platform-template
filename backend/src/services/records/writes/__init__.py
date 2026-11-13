"""Creating, editing and deleting one record (§9, §73).
See docs/architecture/backend/writes.md."""

from __future__ import annotations

from src.core.facade import lazy

__getattr__, __dir__, __all__ = lazy(__name__, {
    "events": (
        "CREATE_PERMISSION", "UPDATE_PERMISSION", "DELETE_PERMISSION", "_IDENTIFIER_ATTEMPTS",
        "CONCURRENCY_KEY", "update_requested", "derived", "written",
    ),
    "apply": ("apply_values", "_after_write", "_automations", "delete", "remove_row"),
    "coercion": ("_object", "coerce", "_coerced", "_value", "_enum", "_bool"),
    "values": (
        "_number", "_out_of_range", "_moment", "MAX_ITEMS", "MAX_ITEM_CHARS", "_document",
        "_reference", "_target_of", "_text",
    ),
    "identity": (
        "_insert", "_next_identifier", "_refuse_a_lost_race", "_load", "_state", "_message_for",
        "_singular",
    ),
    "commands": ("create", "create_many", "update"),
})
