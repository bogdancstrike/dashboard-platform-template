"""The personal daily brief on Home (§45).
See docs/architecture/backend/brief.md."""

from __future__ import annotations

from src.core.facade import lazy

__getattr__, __dir__, __all__ = lazy(__name__, {
    "gathering": (
        "FEATURE", "MAX_ITEMS", "_OPEN_TASK", "_CLOSED_TICKET", "_task_rows", "gather", "_when",
    ),
    "composing": ("PROMPT", "_fallback", "_item", "_from_model", "_serialise", "get"),
})
