"""Kanban boards (§18): boards read whole, every write the smallest thing that changed.
See docs/architecture/backend/kanban.md."""

from __future__ import annotations

from src.core.facade import lazy

__getattr__, __dir__, __all__ = lazy(__name__, {
    "vocabulary": (
        "RESOURCE", "VIEW_PERMISSION", "MANAGE_PERMISSION", "SHARE_PERMISSION", "PARENT_OF",
        "KINDS", "PRIORITIES", "STARTER_LANES", "MAX_LANES", "CARDS_PER_LANE",
    ),
    "access": (
        "_visible", "_board_statement", "_lane_for", "_writable", "_require_writable",
        "_board_row", "_lane_row", "_card_row",
    ),
    "serializers": ("_state", "_board", "_lane", "comment_counts", "_card"),
    "reading": ("boards", "card", "_possible_parents"),
    "board_view": ("board",),
    "board_writes": ("create_board", "update_board", "remove_board", "_board_key"),
    "lanes": (
        "create_lane", "update_lane", "remove_lane", "arrange_lanes", "_clear_done", "_wip_limit",
    ),
    "cards": ("create_card", "update_card", "remove_card"),
    "moves": ("move_card", "_renumber"),
    "fields": (
        "_next_position", "_next_reference", "_kind", "_priority", "_labels", "_due_date",
        "_person", "_checklist", "_parent_for",
    ),
})
