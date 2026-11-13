"""The assistant (§41): conversations with history, and one streamed turn.

A conversation belongs to one person and is readable by nobody else. Each has
a mode — ``general`` (a plain assistant) or ``data`` (it may call the
read-only tools in `assistant_tools`, with its owner's permissions) — that can
be switched between turns; every message records the mode it was written in.

A turn is streamed as server-sent events:

    event: start   data: {"message_id": …, "user_message": {…}}
    event: delta   data: {"text": "…"}
    event: tool    data: {"name": …, "summary": …}
    event: done    data: {"message": {…}}          (the saved assistant turn)
    event: error   data: {"message": "…", "code": …}

If the reader stops it — closes the request — the words already written are
saved with status ``stopped``, so the history shows what they saw.
"""

from __future__ import annotations

import json
import time
from collections.abc import Iterator
from typing import Any

from sqlalchemy import func, or_, select

from src.config import Config
from src.core import llm
from src.core.clock import iso, now
from src.core.db import session_scope
from src.core.errors import ApiError, NotFoundError, ValidationError
from src.core.pagination import envelope, parse_page, parse_uuid
from src.services.ai import usage as ai, tools as assistant_tools

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


# ── Serialising ───────────────────────────────────────────────────────────


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


# ── Conversations ─────────────────────────────────────────────────────────


def _own(session, conversation_id: Any, principal):
    from src.models.assistant import AssistantConversation

    identifier = parse_uuid(conversation_id, field="conversation_id")
    row = session.get(AssistantConversation, identifier)
    if row is None or row.user_id != principal.user_id:
        # The same answer for "not yours" as for "not there".
        raise NotFoundError("That conversation does not exist.", details={"id": str(identifier)})
    return row


def _mode(raw: Any, default: str = "general") -> str:
    mode = str(raw or default).strip().lower()
    if mode not in MODES:
        raise ValidationError("mode must be general or data", details={"field": "mode", "allowed": list(MODES)})
    return mode


def sources_of(row) -> dict[str, Any]:
    raw = row.sources or {}
    return {"records": bool(raw.get("records", True)), "collections": list(raw.get("collections") or []),
            "documents": list(raw.get("documents") or [])}


def _sources(session, raw: Any, *, principal) -> dict[str, Any]:
    """What a Data-mode turn may read, checked against what the reader may see."""
    from src.services.knowledge import collections as knowledge

    if not isinstance(raw, dict):
        raise ValidationError("sources must be an object.", details={"field": "sources"})
    visible = {str(i) for i in knowledge.visible_ids(session, principal)}
    collections = [str(c) for c in raw.get("collections") or []][:20]
    hidden = [c for c in collections if c not in visible]
    if hidden:
        raise ValidationError("You may not use those collections.", details={"collections": hidden})
    documents = [str(d) for d in raw.get("documents") or []][:100]
    records = bool(raw.get("records", True))
    if not records and not collections:
        raise ValidationError("Choose your records, a collection, or both.", details={"field": "sources"})
    return {"records": records, "collections": collections, "documents": documents}


def _title(raw: Any) -> str:
    title = " ".join(str(raw or "").split())[:200]
    if not title:
        raise ValidationError("A conversation needs a title.", details={"field": "title"})
    return title


def list_conversations(session, args, *, principal) -> dict[str, Any]:
    from src.models.assistant import AssistantConversation, AssistantMessage

    principal.require(ai.AI_PERMISSION)
    page = parse_page(args, default_sort="last_message_at")
    statement = select(AssistantConversation).where(AssistantConversation.user_id == principal.user_id)
    term = str(args.get("q") or "").strip()[:200]
    if term:
        # The title, or anything said in it — "the one where I asked about refunds".
        said = select(AssistantMessage.conversation_id).where(AssistantMessage.content.ilike(f"%{term}%"))
        statement = statement.where(or_(AssistantConversation.title.ilike(f"%{term}%"),
                                        AssistantConversation.id.in_(said)))
    total = session.scalar(select(func.count()).select_from(statement.subquery())) or 0
    rows = session.scalars(
        statement.order_by(
            func.coalesce(AssistantConversation.last_message_at, AssistantConversation.created_at).desc()
        ).offset(page.offset).limit(page.page_size)
    ).all()
    return envelope([conversation_dict(r) for r in rows], total, page)


def create_conversation(session, body: dict[str, Any] | None, *, principal) -> dict[str, Any]:
    from src.models.assistant import AssistantConversation

    principal.require(ai.AI_PERMISSION)
    body = body or {}
    row = AssistantConversation(
        user_id=principal.user_id,
        title=_title(body.get("title")) if body.get("title") else DEFAULT_TITLE,
        mode=_mode(body.get("mode")),
        sources=_sources(session, body["sources"], principal=principal) if body.get("sources") else None,
        message_count=0,
    )
    session.add(row)
    session.flush()
    return conversation_dict(row, messages=[])


def get_conversation(session, conversation_id, *, principal) -> dict[str, Any]:
    principal.require(ai.AI_PERMISSION)
    row = _own(session, conversation_id, principal)
    return conversation_dict(row, messages=list(row.messages))


def update_conversation(session, conversation_id, body: dict[str, Any] | None, *, principal) -> dict[str, Any]:
    principal.require(ai.AI_PERMISSION)
    row = _own(session, conversation_id, principal)
    body = body or {}
    if "title" in body:
        row.title = _title(body.get("title"))
    if "mode" in body:
        row.mode = _mode(body.get("mode"))
    if "sources" in body:
        row.sources = _sources(session, body.get("sources") or {}, principal=principal)
    row.updated_at = now()
    session.flush()
    return conversation_dict(row)


def delete_conversation(session, conversation_id, *, principal) -> dict[str, Any]:
    principal.require(ai.AI_PERMISSION)
    row = _own(session, conversation_id, principal)
    ident = str(row.id)
    session.delete(row)
    session.flush()
    return {"id": ident, "deleted": True}


def usage(session, *, principal) -> dict[str, Any]:
    """This person's AI usage: today and the last 30 days, by feature."""
    from datetime import timedelta

    from src.models.assistant import AiUsage

    principal.require(ai.AI_PERMISSION)
    since = now() - timedelta(days=30)
    rows = session.execute(
        select(AiUsage.feature, func.count(), func.coalesce(func.sum(AiUsage.total_tokens), 0))
        .where(AiUsage.user_id == principal.user_id, AiUsage.created_at > since)
        .group_by(AiUsage.feature)
    ).all()
    by_feature = [{"feature": f, "calls": int(n), "tokens": int(t)} for f, n, t in rows]
    return {
        "calls": sum(r["calls"] for r in by_feature),
        "tokens": sum(r["tokens"] for r in by_feature),
        "by_feature": sorted(by_feature, key=lambda r: -r["tokens"]),
        "limit_per_minute": Config.LLM_RATE_PER_MINUTE,
        **ai.status(),
    }


# ── A turn ────────────────────────────────────────────────────────────────

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

