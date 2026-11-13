"""Boards, lanes and cards as the API returns them."""

from __future__ import annotations

from typing import Any

from sqlalchemy import func, select

from src.core.clock import iso
from src.core.naming import initials
from src.services.work.kanban.access import _writable


def _state(row) -> dict[str, Any]:
    """What the audit trail records about a card — the decisions, not the row."""
    return {
        "title": row.title,
        "kind": row.kind,
        "priority": row.priority,
        "assignee_id": str(row.assignee_id) if row.assignee_id else None,
        "labels": list(row.labels or []),
        "story_points": float(row.story_points) if row.story_points is not None else None,
        "parent_id": str(row.parent_id) if row.parent_id else None,
        "checklist_done": sum(1 for item in (row.checklist or []) if item.get("done")),
        "checklist_total": len(row.checklist or []),
    }


def _board(row, principal, *, cards: int | None = None) -> dict[str, Any]:
    body: dict[str, Any] = {
        "id": str(row.id),
        "key": row.key,
        "name": row.name,
        "description": row.description,
        "scope": row.scope,
        "is_archived": bool(row.is_archived),
        "owner": {
            "id": str(row.owner_id) if row.owner_id else None,
            "is_me": row.owner_id == principal.user_id,
        },
        "lane_count": len([lane for lane in row.lanes if lane.deleted_at is None]),
        "can_edit": _writable(row, principal),
        "created_at": iso(row.created_at) if row.created_at else None,
        "updated_at": iso(row.updated_at) if row.updated_at else None,
    }
    if cards is not None:
        body["card_count"] = cards
    return body


def _lane(row) -> dict[str, Any]:
    return {
        "id": str(row.id),
        "name": row.name,
        "position": row.position,
        "wip_limit": row.wip_limit,
        "is_done": bool(row.is_done),
    }


def comment_counts(session, card_ids: list[Any]) -> dict[Any, int]:
    """How many live comments each of these cards carries, in one query.

    The conversation is polymorphic — `resource_type` + `resource_id`, the same
    table the record pages use — so this is a `GROUP BY` over the ids rather
    than a relationship the model could load. Empty in, empty out: `IN ()` is
    not a query worth sending.
    """
    from src.models.content import Comment

    if not card_ids:
        return {}
    rows = session.execute(
        select(Comment.resource_id, func.count())
        .where(
            Comment.resource_type == "kanban_card",
            Comment.resource_id.in_([str(identifier) for identifier in card_ids]),
            Comment.deleted_at.is_(None),
        )
        .group_by(Comment.resource_id)
    ).all()
    # Keyed by the UUID the caller passed, not the string the column holds, so
    # the caller can look up with what it has.
    by_id = {str(resource_id): int(count) for resource_id, count in rows}
    return {identifier: by_id.get(str(identifier), 0) for identifier in card_ids}


def _card(row, *, comments: int = 0) -> dict[str, Any]:
    checklist = list(row.checklist or [])
    return {
        "id": str(row.id),
        "board_id": str(row.board_id),
        "lane_id": str(row.lane_id) if row.lane_id else None,
        "reference": row.reference,
        "kind": row.kind,
        "title": row.title,
        "description": row.description,
        "parent_id": str(row.parent_id) if row.parent_id else None,
        "position": row.position,
        "priority": row.priority,
        "story_points": float(row.story_points) if row.story_points is not None else None,
        "assignee": {
            "id": str(row.assignee_id) if row.assignee_id else None,
            "name": row.assignee.full_name if row.assignee else None,
            "initials": initials(row.assignee.full_name) if row.assignee else None,
        },
        "labels": list(row.labels or []),
        "due_date": row.due_date.isoformat() if row.due_date else None,
        "started_at": iso(row.started_at) if row.started_at else None,
        "completed_at": iso(row.completed_at) if row.completed_at else None,
        "checklist": checklist,
        "checklist_done": sum(1 for item in checklist if item.get("done")),
        # Zero unless the caller counted: a card fetched on its own draws the
        # thread itself, and a number beside the thread it is showing would be
        # a second answer to the same question.
        "comment_count": comments,
        "created_at": iso(row.created_at) if row.created_at else None,
        "updated_at": iso(row.updated_at) if row.updated_at else None,
    }
