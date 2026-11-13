"""The AI assistant's endpoints (§41–46). Every one needs `ai.use`."""

from __future__ import annotations

from typing import Any

from src.api.handler import Call, endpoint
from src.core.auth import json_body, me, requires
from src.core.db import session_scope
from src.services.ai import (
    assistant as service,
)
from src.services.ai import (
    brief as assistant_brief,
)
from src.services.ai import (
    filters as ai_filters,
)
from src.services.ai import (
    page_help,
)
from src.services.ai import (
    usage as ai,
)

AI = ai.AI_PERMISSION


@requires(AI)
@endpoint
def conversations(call: Call):
    """This person's conversations (newest first, searchable), or a new one."""
    principal = me()
    with session_scope() as session:
        if call.method == "POST":
            return service.create_conversation(session, call.body, principal=principal), 201
        args = call.args
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
@endpoint
def messages(call: Call, conversation_id=None):
    """Ask — or ask again — and stream the answer as server-sent events."""
    from flask import Response, stream_with_context

    principal = me()
    with session_scope() as session:
        turn = service.begin_turn(session, conversation_id, call.body, principal=principal)
    return Response(
        stream_with_context(service.stream_turn(turn, principal=principal)),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@requires(AI)
@endpoint
def usage(call: Call):
    """What this person's AI use has cost in tokens, and which model answers."""
    with session_scope() as session:
        return service.usage(session, principal=me()), 200


@requires("records.view", AI)
@endpoint
def filters(call: Call):
    """A described question → the explorer's condition tree, validated and counted."""
    with session_scope() as session:
        return ai_filters.compile_question(session, call.body, principal=me()), 200


@requires(AI)
@endpoint
def brief(call: Call):
    """Today's brief (cached per day); POST writes it again."""
    refresh = call.method == "POST"
    with session_scope() as session:
        return assistant_brief.get(session, principal=me(), refresh=refresh), 200


@requires(AI)
@endpoint
def page_question(call: Call):
    """A how-to question about the page the reader is on."""
    with session_scope() as session:
        return page_help.ask(session, call.body, principal=me()), 200


@requires(AI)
@endpoint
def page_action(call: Call):
    """Record that a proposed action was confirmed and run."""
    with session_scope() as session:
        return page_help.confirm(session, call.body, principal=me()), 200
