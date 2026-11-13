"""One page as the reader sees it: breadcrumbs, links, tasks, the event it belongs to."""

from __future__ import annotations

from typing import Any

from sqlalchemy import select

from src.core.clock import iso
from src.core.pagination import parse_uuid
from src.core.repository import get_or_404
from src.services.collaboration.docs.blocks import EDIT, VIEW
from src.services.collaboration.docs.wiki_spaces import _space, _space_dict


def _page(session, page_id: Any):
    from src.models.collab import DocPage

    row = get_or_404(
        session,
        DocPage,
        parse_uuid(page_id, field="page_id"),
        "That page does not exist.",
        live=True,
    )
    return row


def _person(user) -> dict[str, Any] | None:
    if user is None:
        return None
    return {"id": str(user.id), "name": user.full_name, "avatar_url": user.avatar_url}


def _breadcrumbs(session, row) -> list[dict[str, Any]]:
    from src.models.collab import DocPage

    trail: list[dict[str, Any]] = []
    parent_id = row.parent_id
    guard = 0
    while parent_id is not None and guard < 32:
        parent = session.get(DocPage, parent_id)
        if parent is None:
            break
        trail.insert(0, {"id": str(parent.id), "title": parent.title, "icon": parent.icon})
        parent_id = parent.parent_id
        guard += 1
    return trail


def _links(session, page_id) -> list[dict[str, Any]]:
    from src.models.collab import DocLink

    rows = session.scalars(
        select(DocLink).where(DocLink.page_id == page_id).order_by(DocLink.created_at)
    ).all()
    return [
        {"id": str(row.id), "resource_type": row.resource_type, "resource_id": row.resource_id,
         "label": row.label, "source": row.source}
        for row in rows
    ]


def _tasks(session, blocks: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """The live state of every task an action item became."""
    from src.models.business import Task
    from src.models.identity import User

    ids = [parse_uuid(block["task_id"], field="task_id")
           for block in blocks if block.get("kind") == "action" and block.get("task_id")]
    if not ids:
        return {}
    rows = session.execute(
        select(Task.id, Task.reference, Task.title, Task.status, Task.due_date, User.full_name)
        .outerjoin(User, User.id == Task.assignee_id)
        .where(Task.id.in_(ids), Task.deleted_at.is_(None))
    ).all()
    return {
        str(task_id): {"id": str(task_id), "reference": reference, "title": title, "status": status,
                       "due_date": iso(due), "assignee": assignee}
        for task_id, reference, title, status, due, assignee in rows
    }


def _event_summary(session, event_id) -> dict[str, Any] | None:
    from src.models.business import CalendarEvent

    if event_id is None:
        return None
    event = session.get(CalendarEvent, event_id)
    if event is None:
        return None
    return {
        "id": str(event.id), "title": event.title, "starts_at": iso(event.starts_at),
        "ends_at": iso(event.ends_at), "location": event.location,
        "participants": [
            {"user_id": item.get("user_id"), "name": item.get("name") or item.get("email"),
             "response": item.get("response")}
            for item in (event.participants or []) if isinstance(item, dict)
        ],
    }


def page(session, page_id: Any, *, principal) -> dict[str, Any]:
    principal.require(VIEW)
    row = _page(session, page_id)
    space = _space(session, row.space_id)
    blocks = list(row.blocks or [])
    return {
        "id": str(row.id),
        "space": _space_dict(space),
        "parent_id": str(row.parent_id) if row.parent_id else None,
        "title": row.title,
        "icon": row.icon,
        "blocks": blocks,
        "version": row.version,
        "template": row.template,
        "breadcrumbs": _breadcrumbs(session, row),
        "links": _links(session, row.id),
        "tasks": _tasks(session, blocks),
        "event": _event_summary(session, row.event_id),
        "created_by": _person(row.created_by),
        "updated_by": _person(row.updated_by),
        "created_at": iso(row.created_at),
        "updated_at": iso(row.updated_at),
        "can_edit": principal.can(EDIT),
        "can_create_tasks": principal.can("records.create", "tasks.view"),
    }
