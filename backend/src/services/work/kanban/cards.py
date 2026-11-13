"""Cards: create, change and remove."""

from __future__ import annotations

from typing import Any

from sqlalchemy import select

from src.core.clock import now
from src.core.errors import ValidationError
from src.services.work.kanban.access import (
    _board_row,
    _card_row,
    _lane_for,
    _require_writable,
)
from src.services.work.kanban.fields import (
    _checklist,
    _due_date,
    _kind,
    _labels,
    _next_position,
    _next_reference,
    _parent_for,
    _person,
    _priority,
)
from src.services.work.kanban.moves import _renumber
from src.services.work.kanban.serializers import _card, _state


def create_card(session, board_id: Any, payload: Any, *, principal) -> dict[str, Any]:
    from src.core import audit
    from src.models.kanban import BoardCard

    row = _board_row(session, board_id, principal)
    _require_writable(row, principal)
    body = payload if isinstance(payload, dict) else {}

    title = str(body.get("title") or "").strip()
    if not title:
        raise ValidationError("A card needs a title.")

    kind = _kind(body.get("kind") or "TASK")
    lane = _lane_for(row, body.get("lane_id"))
    parent = _parent_for(session, row, body.get("parent_id"), kind)

    card_row = BoardCard(
        board_id=row.id,
        lane_id=lane.id,
        reference=_next_reference(session, row),
        kind=kind,
        title=title[:240],
        description=str(body.get("description") or "").strip() or None,
        parent_id=parent.id if parent else None,
        position=_next_position(session, lane.id),
        priority=_priority(body.get("priority") or "NORMAL"),
        story_points=body.get("story_points"),
        assignee_id=_person(body.get("assignee_id")),
        reporter_id=principal.user_id,
        labels=_labels(body.get("labels")),
        due_date=_due_date(body.get("due_date")),
    )
    session.add(card_row)
    session.flush()
    audit.record(
        session,
        action="CREATE",
        resource_type="kanban_card",
        resource_id=card_row.id,
        resource_label=f"{card_row.reference} {card_row.title}",
        principal=principal,
        after={"kind": kind, "lane": lane.name, "title": card_row.title},
    )
    return _card(card_row)


def update_card(session, card_id: Any, payload: Any, *, principal) -> dict[str, Any]:
    from src.core import audit

    row = _card_row(session, card_id, principal)
    board_row = _board_row(session, row.board_id, principal)
    _require_writable(board_row, principal)
    body = payload if isinstance(payload, dict) else {}
    before = _state(row)

    if "title" in body:
        title = str(body.get("title") or "").strip()
        if not title:
            raise ValidationError("A card needs a title.")
        row.title = title[:240]
    if "description" in body:
        row.description = str(body.get("description") or "").strip() or None
    if "kind" in body:
        row.kind = _kind(body.get("kind"))
        # Re-checked, because the new kind may not belong under the old parent.
        if row.parent_id:
            _parent_for(session, board_row, str(row.parent_id), row.kind)
    if "priority" in body:
        row.priority = _priority(body.get("priority"))
    if "story_points" in body:
        row.story_points = body.get("story_points")
    if "assignee_id" in body:
        row.assignee_id = _person(body.get("assignee_id"))
    if "labels" in body:
        row.labels = _labels(body.get("labels"))
    if "due_date" in body:
        row.due_date = _due_date(body.get("due_date"))
    if "checklist" in body:
        row.checklist = _checklist(body.get("checklist"))
    if "parent_id" in body:
        parent = _parent_for(session, board_row, body.get("parent_id"), row.kind)
        row.parent_id = parent.id if parent else None

    session.flush()
    audit.record(
        session,
        action="UPDATE",
        resource_type="kanban_card",
        resource_id=row.id,
        resource_label=f"{row.reference} {row.title}",
        principal=principal,
        before=before,
        after=_state(row),
    )
    return _card(row)


def remove_card(session, card_id: Any, *, principal) -> dict[str, Any]:
    """Delete a card, and re-parent whatever hung off it.

    Its children are not deleted with it: a story removed by mistake must not
    take three tasks' comments and history with it.
    """
    from src.core import audit
    from src.models.kanban import BoardCard

    row = _card_row(session, card_id, principal)
    board_row = _board_row(session, row.board_id, principal)
    _require_writable(board_row, principal)

    orphaned = session.scalars(
        select(BoardCard).where(BoardCard.parent_id == row.id, BoardCard.deleted_at.is_(None))
    ).all()
    for child in orphaned:
        child.parent_id = row.parent_id if row.parent_id else None

    row.deleted_at = now()
    if row.lane_id:
        _renumber(session, row.lane_id)
    session.flush()
    audit.record(
        session,
        action="DELETE",
        resource_type="kanban_card",
        resource_id=row.id,
        resource_label=f"{row.reference} {row.title}",
        principal=principal,
        metadata={"reparented": len(orphaned)},
    )
    return {
        "id": str(row.id),
        "reference": row.reference,
        "deleted": True,
        "reparented": len(orphaned),
    }
