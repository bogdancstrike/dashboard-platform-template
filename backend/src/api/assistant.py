"""The AI assistant's endpoints (§41–46). Every one needs `ai.use`."""

from __future__ import annotations

from typing import Any

from src.core.auth import json_body, me, requires
from src.core.db import session_scope
from src.services import ai, ai_filters, assistant as service, assistant_brief, page_help

AI = ai.AI_PERMISSION


@requires(AI)
def conversations(app=None, operation: str = "", request=None, **_: Any):
    """This person's conversations (newest first, searchable), or a new one."""
    principal = me()
    with session_scope() as session:
        if request is not None and request.method == "POST":
            return service.create_conversation(session, json_body(), principal=principal), 201
        args = request.args.to_dict() if request is not None else {}
        return service.list_conversations(session, args, principal=principal), 200


@requires(AI)
def conversation(app=None, operation: str = "", request=None, conversation_id=None, **_: Any):
    """One conversation with its messages; rename it or switch its mode; delete it."""
    principal = me()
    method = request.method if request is not None else "GET"
    with session_scope() as session:
        if method == "PATCH":
            return service.update_conversation(session, conversation_id, json_body(), principal=principal), 200
        if method == "DELETE":
            return service.delete_conversation(session, conversation_id, principal=principal), 200
        return service.get_conversation(session, conversation_id, principal=principal), 200


@requires(AI)
def messages(app=None, operation: str = "", request=None, conversation_id=None, **_: Any):
    """Ask — or ask again — and stream the answer as server-sent events."""
    from flask import Response, stream_with_context

    principal = me()
    with session_scope() as session:
        turn = service.begin_turn(session, conversation_id, json_body(), principal=principal)
    return Response(
        stream_with_context(service.stream_turn(turn, principal=principal)),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@requires(AI)
def usage(app=None, operation: str = "", request=None, **_: Any):
    """What this person's AI use has cost in tokens, and which model answers."""
    with session_scope() as session:
        return service.usage(session, principal=me()), 200


@requires("records.view", AI)
def filters(app=None, operation: str = "", request=None, **_: Any):
    """A described question → the explorer's condition tree, validated and counted."""
    with session_scope() as session:
        return ai_filters.compile_question(session, json_body(), principal=me()), 200


@requires(AI)
def brief(app=None, operation: str = "", request=None, **_: Any):
    """Today's brief (cached per day); POST writes it again."""
    refresh = request is not None and request.method == "POST"
    with session_scope() as session:
        return assistant_brief.get(session, principal=me(), refresh=refresh), 200


@requires(AI)
def page_question(app=None, operation: str = "", request=None, **_: Any):
    """A how-to question about the page the reader is on."""
    with session_scope() as session:
        return page_help.ask(session, json_body(), principal=me()), 200


@requires(AI)
def page_action(app=None, operation: str = "", request=None, **_: Any):
    """Record that a proposed action was confirmed and run."""
    with session_scope() as session:
        return page_help.confirm(session, json_body(), principal=me()), 200
