"""Conversations: list, create, read, change, delete, and usage."""

from __future__ import annotations

from typing import Any

from sqlalchemy import func, or_, select

from src.config import Config
from src.core.clock import now
from src.core.errors import NotFoundError, ValidationError
from src.core.pagination import envelope, parse_page, parse_uuid
from src.services.ai import usage as ai
from src.services.ai.assistant.serializers import (
    DEFAULT_TITLE,
    MODES,
    conversation_dict,
)


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
