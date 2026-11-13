"""What a task page shows beside the record: its place in the plan (§18).
See docs/architecture/backend/task-planning.md."""

from __future__ import annotations

from src.core.facade import lazy

__getattr__, __dir__, __all__ = lazy(__name__, {
    "board_planning": ("_brief", "planning", "watch", "lanes"),
    "lane_settings": ("set_lanes", "epics"),
})
