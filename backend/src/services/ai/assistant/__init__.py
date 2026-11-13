"""The assistant (§41): conversations with history, and one streamed turn.
See docs/architecture/backend/assistant.md."""

from __future__ import annotations

from src.core.facade import lazy

__getattr__, __dir__, __all__ = lazy(__name__, {
    "serializers": (
        "FEATURE", "MODES", "DEFAULT_TITLE", "MAX_MESSAGE", "HISTORY_TURNS", "MAX_ROUNDS",
        "TIME_LIMIT_NOTE", "conversation_dict", "message_dict", "sources_of",
    ),
    "conversations": (
        "_own", "_mode", "_sources", "_title", "list_conversations", "create_conversation",
        "get_conversation", "update_conversation", "delete_conversation", "usage",
    ),
    "prompting": (
        "GENERAL_PROMPT", "DATA_PROMPT", "DOCUMENTS_PROMPT", "_system", "_history", "_sse",
        "begin_turn",
    ),
    "streaming": ("stream_turn",),
})
