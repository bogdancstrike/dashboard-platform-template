"""Meeting notes on calendar events, and the tasks taken from them."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import select

from src.core.clock import iso
from src.core.errors import ConflictError, NotFoundError, ValidationError
from src.core.pagination import parse_uuid
from src.core.repository import get_or_404
from src.services.collaboration.docs.blocks import (
    EDIT,
    MEETINGS_SPACE,
    VIEW,
    plain_text,
)
from src.services.collaboration.docs.links import add_link
from src.services.collaboration.docs.page_templates import meeting_blocks
from src.services.collaboration.docs.page_view import _page, _person, page
from src.services.collaboration.docs.page_writes import create_page


def meetings_space(session, principal=None):
    """The space meeting notes are filed in, made the first time it is needed."""
    from src.models.collab import DocSpace

    row = session.scalars(
        select(DocSpace).where(DocSpace.kind == "MEETINGS", DocSpace.deleted_at.is_(None))
        .order_by(DocSpace.created_at).limit(1)
    ).first()
    if row is None:
        row = DocSpace(key=MEETINGS_SPACE, name="Meetings", icon="🗓️", color="#0E9F6E", kind="MEETINGS",
                       description="Notes from meetings, filed by the calendar event they were taken in.",
                       position=-1024, created_by_id=getattr(principal, "user_id", None))
        session.add(row)
        session.flush()
    return row


def meeting_notes(session, args, *, principal) -> dict[str, Any]:
    """The notes taken in one event."""
    from src.models.collab import DocPage

    principal.require(VIEW)
    event_id = parse_uuid(args.get("event_id"), field="event_id")
    rows = session.scalars(
        select(DocPage).where(DocPage.event_id == event_id, DocPage.deleted_at.is_(None))
        .order_by(DocPage.created_at)
    ).all()
    items = []
    for row in rows:
        actions = [block for block in row.blocks or [] if block.get("kind") == "action" and block.get("text")]
        items.append({
            "id": str(row.id), "title": row.title, "updated_at": iso(row.updated_at),
            "created_by": _person(row.created_by),
            "actions": len(actions), "tasks": sum(1 for block in actions if block.get("task_id")),
        })
    return {"items": items, "can_edit": principal.can(EDIT)}


def take_notes(session, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    """Open the event's notes — the existing page, or a new one filled in."""
    from src.models.business import CalendarEvent
    from src.models.collab import DocPage

    principal.require(EDIT)
    principal.require("calendar.view")
    event_id = parse_uuid((payload or {}).get("event_id"), field="event_id")
    event = get_or_404(session, CalendarEvent, event_id, "That event does not exist.", live=True)
    existing = session.scalars(
        select(DocPage).where(DocPage.event_id == event.id, DocPage.deleted_at.is_(None))
        .order_by(DocPage.created_at).limit(1)
    ).first()
    if existing is not None and not (payload or {}).get("new"):
        return {**page(session, existing.id, principal=principal), "created": False}
    space = meetings_space(session, principal)
    day = event.starts_at.strftime("%Y-%m-%d") if isinstance(event.starts_at, datetime) else ""
    result = create_page(session, {
        "space_id": str(space.id), "title": f"{event.title} — {day}".strip(" —"), "icon": "🗓️",
        "template": "meeting", "blocks": meeting_blocks(event),
    }, principal=principal, event_id=event.id)
    return {**result, "created": True}


def create_task(session, page_id: Any, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    """Turn one action item into a real task, and remember which."""
    from src.services.records import writes as record_writes

    principal.require(EDIT)
    row = _page(session, page_id)
    block_id = str((payload or {}).get("block_id") or "")
    blocks = [dict(block) for block in row.blocks or []]
    block = next((item for item in blocks if item.get("id") == block_id), None)
    if block is None or block.get("kind") != "action":
        raise NotFoundError("That action item does not exist.", details={"block_id": block_id})
    if block.get("task_id"):
        raise ConflictError("That action item is already a task.", details={"task_id": block["task_id"]})
    if not str(block.get("text") or "").strip():
        raise ValidationError("An action item needs words before it can be a task.", details={"field": "text"})

    values: dict[str, Any] = {
        "title": str(block["text"]).strip()[:240],
        "description": f"From the page “{row.title}”.",
        "status": "NEW",
        "priority": "NORMAL",
    }
    if block.get("assignee_id"):
        values["assignee_id"] = block["assignee_id"]
    if block.get("due_date"):
        values["due_date"] = block["due_date"]
    task = record_writes.create(session, "task", values, principal=principal)

    block["task_id"] = task["id"]
    row.blocks = blocks
    session.flush()
    add_link(session, row.id, {"resource_type": "task", "resource_id": task["id"]},
             principal=principal, source="ACTION")
    return page(session, row.id, principal=principal)


def summarise(session, page_id: Any, *, principal) -> dict[str, Any]:
    """An AI summary of the page — for meeting notes, the minutes in brief."""
    from src.core import llm
    from src.services.ai import usage as ai

    principal.require(VIEW)
    row = _page(session, page_id)
    ai.guard(session, principal, "docs_summary")
    text = plain_text(row.title, list(row.blocks or []))
    if len(text.strip()) < 20:
        raise ValidationError("There is not enough on this page to summarise yet.")
    messages = [
        {"role": "system", "content": (
            "You summarise workplace documents and meeting notes. Reply with 2-4 short sentences "
            "of plain prose, then, if there are any, a line 'Actions:' followed by one action per "
            "line as '- who: what'. No headings, no preamble."
        )},
        {"role": "user", "content": f"Title: {row.title}\n\n{text[:12000]}"},
    ]
    try:
        result = llm.get_client().chat(messages, max_tokens=400, user=str(principal.user_id))
    except llm.LlmError as exc:
        ai.record_usage(session, principal, "docs_summary", status="error")
        raise ai.unavailable(exc) from exc
    ai.record_usage(session, principal, "docs_summary", result.usage, model=getattr(result, "model", None))
    ai.audit(session, principal, resource_type="doc_page", resource_id=row.id,
             label=f"summarised {row.title}")
    return {"summary": (result.text or "").strip(), "page_id": str(row.id)}
