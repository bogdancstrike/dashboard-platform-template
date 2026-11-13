"""Streaming one turn: tools, rounds and the time budget."""

from __future__ import annotations

import time
from collections.abc import Iterator
from typing import Any

from src.config import Config
from src.core import llm
from src.core.clock import now
from src.core.db import session_scope
from src.core.errors import ApiError
from src.services.ai import tools as assistant_tools
from src.services.ai import usage as ai
from src.services.ai.assistant.prompting import _sse
from src.services.ai.assistant.serializers import (
    FEATURE,
    MAX_ROUNDS,
    TIME_LIMIT_NOTE,
    message_dict,
)


def stream_turn(turn: dict[str, Any], *, principal) -> Iterator[str]:
    """Run the model (and its tools) and yield server-sent events, saving the
    answer at the end — or wherever the reader stopped it."""
    from src.models.assistant import AssistantConversation, AssistantMessage

    client = llm.get_client()
    mode = turn["mode"]
    messages = list(turn["history"])
    sources = turn.get("sources") or {}
    tools = (assistant_tools.definitions(principal, sources) or None) if mode == "data" else None
    text_parts: list[str] = []
    citations: dict[str, dict[str, str]] = {}
    steps: list[dict[str, Any]] = []
    usage = llm.Usage()
    model = client.model
    status, error = "complete", None
    started = now()
    # The turn's budget across every round (LLM_TURN_MAX_SECONDS). A round is
    # only started if a whole model call still fits — the per-call cap for a
    # real model, nothing for the free fake — so the turn never outruns it.
    deadline = time.monotonic() + float(Config.LLM_TURN_MAX_SECONDS)
    call_needs = 0.0 if getattr(client, "is_fake", False) else min(
        llm.max_seconds(), float(Config.LLM_TURN_MAX_SECONDS))

    yield _sse("start", {"conversation_id": str(turn["conversation_id"]), "title": turn["title"],
                         "mode": mode, "user_message": turn["user_message"]})
    try:
        for round_no in range(MAX_ROUNDS + 1):
            remaining = deadline - time.monotonic()
            if round_no and (remaining <= 0 or remaining < call_needs):
                text_parts.append(TIME_LIMIT_NOTE)
                yield _sse("delta", {"text": TIME_LIMIT_NOTE})
                steps.append({"name": "time_limit", "arguments": {}, "summary": "Stopped at the time limit"})
                break
            last_round = round_no == MAX_ROUNDS
            result = None
            for event in client.stream(messages, None if last_round else tools, user=str(principal.user_id)):
                if event.kind == "text":
                    text_parts.append(event.delta)
                    yield _sse("delta", {"text": event.delta})
                elif event.kind == "done":
                    result = event.result
            if result is None:  # pragma: no cover - every stream ends with done
                break
            usage = usage.add(result.usage)
            model = result.model or model
            with session_scope() as session:
                ai.record_usage(session, principal, FEATURE, result.usage, model=model)
            if not result.tool_calls or last_round:
                break
            messages.append(result.assistant_message())
            for call in result.tool_calls:
                yield _sse("tool", {"name": call.name, "status": "running", "arguments": call.arguments})
                with session_scope() as session:
                    output, cites, summary = assistant_tools.run(session, call.name, call.arguments,
                                                                 principal=principal, sources=sources)
                for cite in cites:
                    citations.setdefault(f"{cite['resource_type']}:{cite['id']}", cite)
                steps.append({"name": call.name, "arguments": call.arguments, "summary": summary})
                yield _sse("tool", {"name": call.name, "status": "done", "summary": summary})
                messages.append({"role": "tool", "tool_call_id": call.id, "content": output})
            if text_parts and not text_parts[-1].endswith("\n"):
                text_parts.append("\n\n")
                yield _sse("delta", {"text": "\n\n"})
    except GeneratorExit:
        status = "stopped"
    except llm.LlmError as exc:
        status, error = "error", ai.unavailable(exc).message
        with session_scope() as session:
            ai.record_usage(session, principal, FEATURE, status="error")
    except ApiError as exc:  # pragma: no cover - tools turn these into tool errors
        status, error = "error", exc.message

    content = "".join(text_parts).strip()
    # Only the records the answer actually names, when it names any; all of
    # them when it names none (a count answer cites what it counted).
    records = [c for c in citations.values() if c["resource_type"] != "document"]
    cited = [c for c in records if c["id"] in content] or records[:12]
    # A passage is cited by its [Dn] marker; none marked means all that were read.
    documents = [c for c in citations.values() if c["resource_type"] == "document"]
    cited += [c for c in documents if c["label"].split(" ", 1)[0] in content] or documents[:6]
    with session_scope() as session:
        saved = AssistantMessage(
            conversation_id=turn["conversation_id"], role="assistant", content=content, mode=mode,
            status=status, citations=cited or None, steps=steps or None, model=(model or "")[:80],
            prompt_tokens=usage.prompt_tokens, completion_tokens=usage.completion_tokens,
            total_tokens=usage.total_tokens, latency_ms=int((now() - started).total_seconds() * 1000),
            error=(error or None) and error[:300], created_at=now(),
        )
        session.add(saved)
        convo = session.get(AssistantConversation, turn["conversation_id"])
        if convo is not None:
            convo.message_count = (convo.message_count or 0) + 1
            convo.last_message_at = now()
        session.flush()
        final = message_dict(saved)
    if status == "stopped":
        return
    if status == "error":
        yield _sse("error", {"message": error, "message_saved": final})
        return
    yield _sse("done", {"message": final})
