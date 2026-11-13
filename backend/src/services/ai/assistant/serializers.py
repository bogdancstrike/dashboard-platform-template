"""Assistant limits, and conversations and messages as the API returns them."""

from __future__ import annotations

from typing import Any

from src.core.clock import iso

FEATURE = "chat"


MODES = ("general", "data")


DEFAULT_TITLE = "New conversation"


MAX_MESSAGE = 8000


#: Turns of history sent with each question. Older ones are still saved and
#: shown; the model simply sees the recent part of a long conversation.
HISTORY_TURNS = 24


#: Tool rounds before the model is told to answer with what it has.
MAX_ROUNDS = 5


#: Appended when a turn reaches LLM_TURN_MAX_SECONDS before the model is done.
TIME_LIMIT_NOTE = ("_I stopped here: this answer reached its time limit. "
                   "Ask a follow-up to continue from what I found._")


def conversation_dict(row, *, messages: list | None = None) -> dict[str, Any]:
    out = {
        "id": str(row.id),
        "title": row.title,
        "mode": row.mode,
        "sources": sources_of(row),
        "message_count": row.message_count,
        "last_message_at": iso(row.last_message_at),
        "created_at": iso(row.created_at),
        "updated_at": iso(row.updated_at),
    }
    if messages is not None:
        out["messages"] = [message_dict(m) for m in messages]
    return out


def message_dict(row) -> dict[str, Any]:
    return {
        "id": str(row.id),
        "conversation_id": str(row.conversation_id),
        "role": row.role,
        "content": row.content,
        "mode": row.mode,
        "status": row.status,
        "citations": row.citations or [],
        "steps": row.steps or [],
        "model": row.model,
        "usage": {
            "prompt_tokens": row.prompt_tokens,
            "completion_tokens": row.completion_tokens,
            "total_tokens": row.total_tokens,
        },
        "latency_ms": row.latency_ms,
        "error": row.error,
        "created_at": iso(row.created_at),
    }


def sources_of(row) -> dict[str, Any]:
    raw = row.sources or {}
    return {"records": bool(raw.get("records", True)), "collections": list(raw.get("collections") or []),
            "documents": list(raw.get("documents") or [])}
