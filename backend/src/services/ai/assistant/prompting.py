"""The system prompt per mode, the history, and beginning a turn."""

from __future__ import annotations

import json
from typing import Any

from src.core.clock import now
from src.core.errors import ValidationError
from src.services.ai import tools as assistant_tools
from src.services.ai import usage as ai
from src.services.ai.assistant.conversations import _mode, _own, _sources
from src.services.ai.assistant.serializers import (
    DEFAULT_TITLE,
    FEATURE,
    HISTORY_TURNS,
    MAX_MESSAGE,
    message_dict,
    sources_of,
)

GENERAL_PROMPT = """You are the Nucleus assistant, built into Nucleus — an enterprise platform for records
(projects, customers, orders, tickets, tasks, devices), mail, calendar, files, reports and dashboards.
Answer clearly and concisely in Markdown (short paragraphs, lists, tables when they help).
Today is {today}. You are talking to {name} ({role}).
In General mode you cannot see the user's records; if they ask about their data, suggest switching the
conversation to Data mode with the toggle above the message box."""


DATA_PROMPT = """
DATA MODE: you can read the user's records with the tools provided — always use them for questions about the
data; never guess numbers. Every tool sees only what this user may see.
Conditions use the explorer's condition tree:
{schema}

Datasets and fields:
{catalogue}

When you mention a record, link it in Markdown with its path, e.g. [TCK-00042](/tickets/<id>).
Say how many records matched when that matters, and keep tables to the useful columns."""


DOCUMENTS_PROMPT = """
DOCUMENTS: the user chose these document collections as sources: {names}.
For anything they might say, call search_documents and answer from the passages it returns, citing each claim
with its reference in square brackets, e.g. [D1] or [D2]. If the passages do not say, say so."""


def _system(principal, mode: str, sources: dict[str, Any] | None = None, session=None) -> str:
    text = GENERAL_PROMPT.format(today=now().strftime("%A %d %B %Y"), name=principal.full_name,
                                 role=principal.role_code.title())
    sources = sources or {"records": True, "collections": []}
    if mode == "data" and sources.get("records", True):
        from src.services.ai.filters import TREE_SCHEMA

        text += DATA_PROMPT.format(schema=TREE_SCHEMA, catalogue=assistant_tools.catalogue_text(principal))
    if mode == "data" and sources.get("collections") and session is not None:
        from src.models.knowledge import KnowledgeCollection

        names = [row.name for row in session.query(KnowledgeCollection)
                 .filter(KnowledgeCollection.id.in_(sources["collections"])).all()]
        text += DOCUMENTS_PROMPT.format(names=", ".join(names) or "(none)")
    return text


def _history(messages: list) -> list[dict[str, Any]]:
    out = []
    for m in messages[-HISTORY_TURNS:]:
        if m.role in ("user", "assistant") and (m.content or "").strip():
            out.append({"role": m.role, "content": m.content})
    return out


def _sse(event: str, data: Any) -> str:
    return f"event: {event}\ndata: {json.dumps(data, default=str)}\n\n"


def begin_turn(session, conversation_id, body: dict[str, Any] | None, *, principal) -> dict[str, Any]:
    """Validate and record the question; return what the stream needs.

    Done before the first byte is sent, so a refusal (no permission, rate
    limit, empty message) is an ordinary JSON error rather than an event in a
    stream that has already said 200."""
    from src.models.assistant import AssistantMessage

    body = body or {}
    ai.guard(session, principal, FEATURE)
    convo = _own(session, conversation_id, principal)
    if "mode" in body:
        convo.mode = _mode(body.get("mode"))
    if body.get("sources"):
        convo.sources = _sources(session, body["sources"], principal=principal)
    messages = list(convo.messages)
    if body.get("regenerate"):
        last_user = next((m for m in reversed(messages) if m.role == "user"), None)
        if last_user is None:
            raise ValidationError("There is nothing to answer again.")
        stale = [m for m in messages if m.role == "assistant" and m.created_at >= last_user.created_at]
        for m in stale:
            session.delete(m)
        session.flush()
        messages = [m for m in messages if m not in stale]
        convo.message_count = len(messages)
        user_message = last_user
    else:
        content = str(body.get("content") or "").strip()
        if not content:
            raise ValidationError("Write a message first.", details={"field": "content"})
        if len(content) > MAX_MESSAGE:
            raise ValidationError(f"Keep a message under {MAX_MESSAGE} characters.", details={"field": "content"})
        user_message = AssistantMessage(conversation_id=convo.id, role="user", content=content, mode=convo.mode,
                                        status="complete", created_at=now())
        session.add(user_message)
        session.flush()
        messages.append(user_message)
        convo.message_count = len(messages)
        if convo.title == DEFAULT_TITLE:
            first = " ".join(content.split())
            convo.title = (first[:60].rsplit(" ", 1)[0] + "…") if len(first) > 60 else first
    convo.last_message_at = now()
    ai.audit(session, principal, resource_type="assistant_conversation", resource_id=convo.id,
             label=f"Asked the assistant ({convo.mode})",
             metadata={"mode": convo.mode, "regenerate": bool(body.get("regenerate")),
                       "chars": len(user_message.content)})
    return {
        "conversation_id": convo.id,
        "mode": convo.mode,
        "title": convo.title,
        "user_message": message_dict(user_message),
        "sources": sources_of(convo),
        "history": [{"role": "system", "content": _system(principal, convo.mode, sources_of(convo), session)},
                    *_history(messages)],
    }
