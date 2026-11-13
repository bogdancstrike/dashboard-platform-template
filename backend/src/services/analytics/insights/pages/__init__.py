"""Insights (§43): ask a question about the records, get a small page back.
See docs/architecture/backend/pages.md."""

from __future__ import annotations

from src.core.facade import lazy

__getattr__, __dir__, __all__ = lazy(__name__, {
    "tools": (
        "USE_PERMISSION", "SHARE_PERMISSION", "KIND", "FEATURE", "MAX_ROUNDS", "MAX_QUESTION",
        "TOOL_RESULT_CHARS", "_catalogue", "REGISTRY_DOC", "SYSTEM_PROMPT", "TOOLS", "_run_tool",
    ),
    "generation": ("generate", "_ask_model"),
    "library": ("_visible", "_row", "serialize", "listing", "detail", "save"),
    "changes": ("update", "refresh", "remove"),
    "planning": ("_WORDS", "plan", "from_suggestion"),
})
