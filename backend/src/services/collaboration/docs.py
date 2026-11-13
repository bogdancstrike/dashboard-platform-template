"""The wiki: spaces, a tree of pages, blocks, history and links (§48–49).

Five decisions worth stating.

**A page is a list of blocks, saved whole.** The same shape the report builder
composes (`HEADING`/`TEXT`/`CHART`/`REPORT` in its vocabulary; lower-case here
because a wiki has many more kinds of words than a report). Saving the whole
list is what makes history simple: a revision is a copy, and restoring is
saving an old copy as the newest one.

**History is kept per save, but a burst of saves is one revision.** The editor
saves as somebody types; fifty revisions for one paragraph is a history nobody
can read. A save by the same person within `COALESCE_MINUTES` of their last
revision rewrites that revision rather than adding one.

**A record mentioned in a page links the page to it.** Record blocks are
reconciled into `doc_links` on every save, beside the links added by hand, so
a ticket can list "pages about this ticket" with an index lookup.

**Meeting notes are pages.** "Take notes" on a calendar event files a page in
the Meetings space, pre-filled with who was invited and what the event said
it was about. Action items in it are blocks that become real tasks on request.

**A move never makes a loop.** Dropping a page under its own descendant is
refused, because the tree view would otherwise lose a branch for good.
"""

from __future__ import annotations

import re
from datetime import datetime, timedelta
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import func, or_, select

from src.core.clock import iso, now
from src.core.errors import ConflictError, ForbiddenError, NotFoundError, ValidationError
from src.core.pagination import parse_uuid
from src.core.repository import get_or_404

VIEW = "docs.view"
EDIT = "docs.edit"

#: A save by the same person this soon after their last revision rewrites it.
COALESCE_MINUTES = 10
MAX_BLOCKS = 400
MAX_TEXT = 20_000
MAX_TITLE = 200

BLOCK_KINDS: tuple[str, ...] = (
    "heading", "text", "list", "checklist", "quote", "code", "callout", "image",
    "table", "divider", "chart", "report", "record", "action",
)
TONES = ("info", "success", "warning", "danger")

MEETINGS_SPACE = "meetings"


# ── templates ────────────────────────────────────────────────────────────


def _b(kind: str, **fields: Any) -> dict[str, Any]:
    return {"id": f"t{uuid4().hex[:8]}", "kind": kind, **fields}


def _template_blocks(key: str) -> list[dict[str, Any]]:
    if key == "meeting":
        return [
            _b("callout", tone="info", text="Date, attendees and agenda go here."),
            _b("heading", level=2, text="Agenda"),
            _b("list", ordered=True, items=["", ""]),
            _b("heading", level=2, text="Notes"),
            _b("text", text=""),
            _b("heading", level=2, text="Decisions"),
            _b("list", ordered=False, items=[""]),
            _b("heading", level=2, text="Action items"),
            _b("action", text="", assignee_id=None, due_date=None, task_id=None),
        ]
    if key == "runbook":
        return [
            _b("callout", tone="warning", text="When to use this runbook, and who owns it."),
            _b("heading", level=2, text="Symptoms"),
            _b("list", ordered=False, items=["", ""]),
            _b("heading", level=2, text="Diagnosis"),
            _b("checklist", items=[{"text": "Check the service health page", "done": False},
                                   {"text": "Read the last hour of error logs", "done": False}]),
            _b("heading", level=2, text="Fix"),
            _b("code", language="bash", text="# commands, one per line"),
            _b("heading", level=2, text="Escalation"),
            _b("text", text="Who to call if the steps above did not work."),
        ]
    if key == "spec":
        return [
            _b("heading", level=2, text="Problem"),
            _b("text", text="What is wrong today, for whom, and how we know."),
            _b("heading", level=2, text="Goals and non-goals"),
            _b("list", ordered=False, items=["Goal:", "Non-goal:"]),
            _b("heading", level=2, text="Proposal"),
            _b("text", text=""),
            _b("heading", level=2, text="Open questions"),
            _b("checklist", items=[{"text": "", "done": False}]),
            _b("heading", level=2, text="Rollout"),
            _b("table", header=True, rows=[["Step", "Owner", "When"], ["", "", ""]]),
        ]
    if key == "retro":
        return [
            _b("heading", level=2, text="What went well"),
            _b("list", ordered=False, items=[""]),
            _b("heading", level=2, text="What did not"),
            _b("list", ordered=False, items=[""]),
            _b("heading", level=2, text="What we will try"),
            _b("action", text="", assignee_id=None, due_date=None, task_id=None),
        ]
    return [_b("text", text="")]


TEMPLATES: tuple[dict[str, str], ...] = (
    {"key": "blank", "name": "Blank page", "icon": "📄",
     "description": "Start from nothing."},
    {"key": "meeting", "name": "Meeting notes", "icon": "🗓️",
     "description": "Agenda, notes, decisions and action items that become tasks."},
    {"key": "runbook", "name": "Runbook", "icon": "🛠️",
     "description": "Symptoms, diagnosis, the fix and who to escalate to."},
    {"key": "spec", "name": "Spec", "icon": "📐",
     "description": "Problem, goals, proposal, open questions and rollout."},
    {"key": "retro", "name": "Retrospective", "icon": "🔁",
     "description": "What went well, what did not, and what to try next."},
)


def templates(*, principal) -> dict[str, Any]:
    principal.require(VIEW)
    return {"items": [{**item, "blocks": _template_blocks(item["key"])} for item in TEMPLATES]}


# ── blocks ───────────────────────────────────────────────────────────────


def _text(raw: Any, field: str, *, limit: int = MAX_TEXT) -> str:
    value = "" if raw is None else str(raw)
    if len(value) > limit:
        raise ValidationError(f"{field} is at most {limit} characters.", details={"field": field})
    return value


def _clean_block(raw: Any, index: int) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raise ValidationError("Each block must be an object.", details={"block": index})
    kind = str(raw.get("kind") or "").lower()
    if kind not in BLOCK_KINDS:
        raise ValidationError(
            f"Block {index + 1} is not a kind the editor knows.",
            details={"block": index, "kind": kind, "allowed": list(BLOCK_KINDS)},
        )
    block: dict[str, Any] = {"id": str(raw.get("id") or f"b{uuid4().hex[:10]}")[:40], "kind": kind}
    where = f"block {index + 1}"
    if kind in ("heading", "text", "quote", "callout", "code"):
        block["text"] = _text(raw.get("text"), where)
    if kind == "heading":
        level = raw.get("level") or 2
        block["level"] = level if level in (1, 2, 3) else 2
    if kind == "code":
        block["language"] = _text(raw.get("language") or "", where, limit=24)
    if kind == "callout":
        tone = str(raw.get("tone") or "info")
        block["tone"] = tone if tone in TONES else "info"
    if kind == "list":
        items = raw.get("items") or []
        if not isinstance(items, list):
            raise ValidationError(f"{where}: items must be a list.", details={"block": index})
        block["items"] = [_text(item, where, limit=2000) for item in items[:200]]
        block["ordered"] = bool(raw.get("ordered"))
    if kind == "checklist":
        items = raw.get("items") or []
        if not isinstance(items, list):
            raise ValidationError(f"{where}: items must be a list.", details={"block": index})
        block["items"] = [
            {"text": _text((item or {}).get("text"), where, limit=2000), "done": bool((item or {}).get("done"))}
            for item in items[:200]
            if isinstance(item, dict)
        ]
    if kind == "table":
        rows = raw.get("rows") or []
        if not isinstance(rows, list) or not all(isinstance(row, list) for row in rows):
            raise ValidationError(f"{where}: rows must be a list of lists.", details={"block": index})
        block["rows"] = [[_text(cell, where, limit=1000) for cell in row[:12]] for row in rows[:100]]
        block["header"] = bool(raw.get("header", True))
    if kind == "image":
        block["file_id"] = str(parse_uuid(raw["file_id"], field="file_id")) if raw.get("file_id") else None
        block["caption"] = _text(raw.get("caption"), where, limit=400)
    if kind in ("chart", "report"):
        # The report builder's own block shape, kept as it arrived: the
        # analysis compiler checks the question when it is drawn.
        for key in ("entity", "dimension", "granularity", "stack", "aggregation", "measure",
                    "period", "chart", "show", "caption", "report_id"):
            if raw.get(key) not in (None, ""):
                block[key] = _text(raw.get(key), where, limit=400)
        if isinstance(raw.get("filters"), dict):
            block["filters"] = {str(k)[:64]: v for k, v in list(raw["filters"].items())[:20]}
    if kind == "record":
        block["resource_type"] = _text(raw.get("resource_type"), where, limit=48)
        block["resource_id"] = str(parse_uuid(raw.get("resource_id"), field="resource_id"))
        block["label"] = _text(raw.get("label"), where, limit=240)
    if kind == "action":
        block["text"] = _text(raw.get("text"), where, limit=500)
        block["assignee_id"] = (
            str(parse_uuid(raw["assignee_id"], field="assignee_id")) if raw.get("assignee_id") else None
        )
        due = raw.get("due_date")
        block["due_date"] = str(due)[:10] if due else None
        block["task_id"] = str(parse_uuid(raw["task_id"], field="task_id")) if raw.get("task_id") else None
        block["done"] = bool(raw.get("done"))
    return block


def clean_blocks(raw: Any) -> list[dict[str, Any]]:
    if raw is None:
        return []
    if not isinstance(raw, list):
        raise ValidationError("blocks must be a list.", details={"field": "blocks"})
    if len(raw) > MAX_BLOCKS:
        raise ValidationError(f"A page holds at most {MAX_BLOCKS} blocks.", details={"field": "blocks"})
    blocks = [_clean_block(item, index) for index, item in enumerate(raw)]
    seen: set[str] = set()
    for block in blocks:
        if block["id"] in seen:
            block["id"] = f"b{uuid4().hex[:10]}"
        seen.add(block["id"])
    return blocks


_MARKS = re.compile(r"[*_`#>\[\]]")


def plain_text(title: str, blocks: list[dict[str, Any]]) -> str:
    """Everything a person could search for on the page, as one string."""
    parts = [title]
    for block in blocks:
        for key in ("text", "caption", "label"):
            if block.get(key):
                parts.append(str(block[key]))
        for item in block.get("items") or []:
            parts.append(item["text"] if isinstance(item, dict) else str(item))
        for row in block.get("rows") or []:
            parts.append(" ".join(row))
    return _MARKS.sub("", "\n".join(part for part in parts if part))[:200_000]


# ── spaces ───────────────────────────────────────────────────────────────


def _space(session, space_id: Any):
    from src.models.collab import DocSpace

    row = get_or_404(
        session,
        DocSpace,
        parse_uuid(space_id, field="space_id"),
        "That space does not exist.",
        live=True,
    )
    return row


def _space_dict(row, pages: int = 0) -> dict[str, Any]:
    return {
        "id": str(row.id),
        "key": row.key,
        "name": row.name,
        "description": row.description,
        "icon": row.icon,
        "color": row.color,
        "kind": row.kind,
        "page_count": pages,
    }


def spaces(session, *, principal) -> dict[str, Any]:
    from src.models.collab import DocPage, DocSpace

    principal.require(VIEW)
    counts = dict(
        session.execute(
            select(DocPage.space_id, func.count()).where(DocPage.deleted_at.is_(None)).group_by(DocPage.space_id)
        ).all()
    )
    rows = session.scalars(
        select(DocSpace).where(DocSpace.deleted_at.is_(None)).order_by(DocSpace.position, DocSpace.name)
    ).all()
    return {
        "items": [_space_dict(row, int(counts.get(row.id, 0))) for row in rows],
        "can_edit": principal.can(EDIT),
    }


def _space_key(raw: Any) -> str:
    key = re.sub(r"[^a-z0-9]+", "-", str(raw or "").lower()).strip("-")[:48]
    if not key:
        raise ValidationError("A space needs a name.", details={"field": "name"})
    return key


def create_space(session, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    from src.models.collab import DocSpace

    principal.require(EDIT)
    payload = payload or {}
    name = _text(payload.get("name"), "name", limit=120).strip()
    key = _space_key(payload.get("key") or name)
    if session.scalar(select(func.count()).select_from(DocSpace).where(DocSpace.key == key)):
        raise ConflictError("There is already a space with that name.", details={"field": "name"})
    top = session.scalar(select(func.max(DocSpace.position))) or 0
    row = DocSpace(
        key=key, name=name, description=_text(payload.get("description"), "description", limit=400) or None,
        icon=_text(payload.get("icon"), "icon", limit=16) or "📚",
        color=_text(payload.get("color"), "color", limit=16) or "#2457D6",
        position=top + 1024, created_by_id=principal.user_id,
    )
    session.add(row)
    session.flush()
    return _space_dict(row)


def update_space(session, space_id: Any, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    principal.require(EDIT)
    row = _space(session, space_id)
    payload = payload or {}
    if "name" in payload:
        name = _text(payload.get("name"), "name", limit=120).strip()
        if not name:
            raise ValidationError("A space needs a name.", details={"field": "name"})
        row.name = name
    if "description" in payload:
        row.description = _text(payload.get("description"), "description", limit=400) or None
    if "icon" in payload:
        row.icon = _text(payload.get("icon"), "icon", limit=16) or None
    session.flush()
    return _space_dict(row)


def delete_space(session, space_id: Any, *, principal) -> dict[str, Any]:
    principal.require(EDIT)
    row = _space(session, space_id)
    if not principal.is_admin and row.created_by_id != principal.user_id:
        raise ForbiddenError("Only whoever made a space, or an administrator, can remove it.")
    if row.kind == "MEETINGS":
        raise ConflictError("The Meetings space is where notes are filed; it cannot be removed.")
    row.deleted_at = now()
    session.flush()
    return {"deleted": True, "id": str(row.id)}


def tree(session, space_id: Any, *, principal) -> dict[str, Any]:
    """Every page in a space, flat, with its parent — the browser builds the tree."""
    from src.models.collab import DocPage

    principal.require(VIEW)
    space = _space(session, space_id)
    rows = session.execute(
        select(DocPage.id, DocPage.parent_id, DocPage.title, DocPage.icon, DocPage.position,
               DocPage.updated_at, DocPage.event_id)
        .where(DocPage.space_id == space.id, DocPage.deleted_at.is_(None))
        .order_by(DocPage.position, DocPage.title)
    ).all()
    return {
        "space": _space_dict(space, len(rows)),
        "items": [
            {
                "id": str(page_id), "parent_id": str(parent) if parent else None, "title": title,
                "icon": icon, "position": position, "updated_at": iso(updated),
                "is_meeting": event is not None,
            }
            for page_id, parent, title, icon, position, updated, event in rows
        ],
    }


# ── pages ────────────────────────────────────────────────────────────────


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


def _next_position(session, space_id, parent_id) -> float:
    from src.models.collab import DocPage

    top = session.scalar(
        select(func.max(DocPage.position)).where(
            DocPage.space_id == space_id,
            DocPage.parent_id.is_(None) if parent_id is None else DocPage.parent_id == parent_id,
            DocPage.deleted_at.is_(None),
        )
    )
    return float(top or 0) + 1024


def _title(raw: Any) -> str:
    title = _text(raw, "title", limit=MAX_TITLE).strip()
    if not title:
        raise ValidationError("A page needs a title.", details={"field": "title"})
    return title


def create_page(session, payload: dict[str, Any], *, principal, event_id: UUID | None = None) -> dict[str, Any]:
    from src.models.collab import DocPage

    principal.require(EDIT)
    payload = payload or {}
    space = _space(session, payload.get("space_id"))
    parent = None
    if payload.get("parent_id"):
        parent = _page(session, payload["parent_id"])
        if parent.space_id != space.id:
            raise ValidationError("A page's parent must be in the same space.", details={"field": "parent_id"})
    template = str(payload.get("template") or "") or None
    if template and template not in {item["key"] for item in TEMPLATES}:
        raise ValidationError("That template does not exist.", details={"field": "template"})
    blocks = clean_blocks(payload["blocks"]) if "blocks" in payload else clean_blocks(
        _template_blocks(template or "blank")
    )
    title = _title(payload.get("title") or next(
        (item["name"] for item in TEMPLATES if item["key"] == template and template != "blank"), "Untitled"
    ))
    row = DocPage(
        space_id=space.id, parent_id=parent.id if parent else None, title=title,
        icon=_text(payload.get("icon"), "icon", limit=16) or None,
        position=_next_position(session, space.id, parent.id if parent else None),
        blocks=blocks, plain_text=plain_text(title, blocks), version=1, template=template,
        event_id=event_id, created_by_id=principal.user_id, updated_by_id=principal.user_id,
    )
    session.add(row)
    session.flush()
    _revise(session, row, principal, note="Created")
    _sync_mentions(session, row, principal)
    session.flush()
    return page(session, row.id, principal=principal)


def _revise(session, row, principal, *, note: str | None = None, force: bool = False) -> None:
    """Record the page as it now stands — or fold this save into the last one."""
    from src.models.collab import DocRevision

    latest = session.scalars(
        select(DocRevision).where(DocRevision.page_id == row.id).order_by(DocRevision.version.desc()).limit(1)
    ).first()
    moment = now()
    if (
        not force and latest is not None and latest.author_id == principal.user_id
        and latest.version == row.version
        and latest.created_at > moment - timedelta(minutes=COALESCE_MINUTES)
    ):
        latest.title = row.title
        latest.blocks = list(row.blocks or [])
        latest.created_at = moment
        return
    if latest is not None and latest.version >= row.version:
        row.version = latest.version + 1
    session.add(DocRevision(
        page_id=row.id, version=row.version, title=row.title, blocks=list(row.blocks or []),
        note=note, author_id=principal.user_id, created_at=moment,
    ))


def update_page(session, page_id: Any, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    principal.require(EDIT)
    row = _page(session, page_id)
    payload = payload or {}
    expected = payload.get("expected_version")
    if expected is not None and int(expected) != row.version:
        raise ConflictError(
            "Somebody else saved this page while you were editing it.",
            details={"version": row.version, "expected_version": expected},
        )
    if "title" in payload:
        row.title = _title(payload.get("title"))
    if "icon" in payload:
        row.icon = _text(payload.get("icon"), "icon", limit=16) or None
    if "blocks" in payload:
        row.blocks = clean_blocks(payload.get("blocks"))
    row.plain_text = plain_text(row.title, list(row.blocks or []))
    row.updated_by_id = principal.user_id
    row.updated_at = now()
    _revise(session, row, principal, note=payload.get("note"))
    _sync_mentions(session, row, principal)
    session.flush()
    session.expire(row, ["updated_by"])
    return page(session, row.id, principal=principal)


def _descendants(session, page_id) -> list[Any]:
    from src.models.collab import DocPage

    found: list[Any] = []
    frontier = [page_id]
    while frontier:
        children = session.scalars(
            select(DocPage.id).where(DocPage.parent_id.in_(frontier), DocPage.deleted_at.is_(None))
        ).all()
        found.extend(children)
        frontier = list(children)
    return found


def delete_page(session, page_id: Any, *, principal) -> dict[str, Any]:
    """Withdraw a page and everything under it. Soft: history stays readable."""
    from src.models.collab import DocPage

    principal.require(EDIT)
    row = _page(session, page_id)
    moment = now()
    ids = [row.id, *_descendants(session, row.id)]
    for item in session.scalars(select(DocPage).where(DocPage.id.in_(ids))).all():
        item.deleted_at = moment
    session.flush()
    return {"deleted": len(ids), "id": str(row.id)}


def move_page(session, page_id: Any, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    """Put a page under a new parent and/or between two siblings.

    `before_id` / `after_id` name the sibling it lands next to; the position
    becomes the midpoint, so a drag writes one row.
    """
    from src.models.collab import DocPage

    principal.require(EDIT)
    row = _page(session, page_id)
    payload = payload or {}
    space_id = row.space_id
    if payload.get("space_id"):
        space_id = _space(session, payload["space_id"]).id
    parent_id = None
    if payload.get("parent_id"):
        parent = _page(session, payload["parent_id"])
        if parent.id == row.id or parent.id in _descendants(session, row.id):
            raise ValidationError("A page cannot be moved inside itself.", details={"field": "parent_id"})
        parent_id = parent.id
        space_id = parent.space_id

    def sibling(key: str):
        if not payload.get(key):
            return None
        other = _page(session, payload[key])
        if other.parent_id != parent_id:
            raise ValidationError("The neighbour must share the new parent.", details={"field": key})
        return other

    before, after = sibling("before_id"), sibling("after_id")
    siblings = session.scalars(
        select(DocPage).where(
            DocPage.space_id == space_id, DocPage.deleted_at.is_(None), DocPage.id != row.id,
            DocPage.parent_id.is_(None) if parent_id is None else DocPage.parent_id == parent_id,
        ).order_by(DocPage.position)
    ).all()
    if before is not None:
        index = next(i for i, item in enumerate(siblings) if item.id == before.id)
        lower = siblings[index - 1].position if index > 0 else before.position - 2048
        position = (lower + before.position) / 2
    elif after is not None:
        index = next(i for i, item in enumerate(siblings) if item.id == after.id)
        upper = siblings[index + 1].position if index + 1 < len(siblings) else after.position + 2048
        position = (after.position + upper) / 2
    else:
        position = (siblings[-1].position if siblings else 0) + 1024

    moving = [row.id, *_descendants(session, row.id)]
    for item in session.scalars(select(DocPage).where(DocPage.id.in_(moving))).all():
        item.space_id = space_id
    row.parent_id = parent_id
    row.position = position
    session.flush()
    return {"id": str(row.id), "parent_id": str(parent_id) if parent_id else None,
            "space_id": str(space_id), "position": position}


# ── history ──────────────────────────────────────────────────────────────


def revisions(session, page_id: Any, *, principal) -> dict[str, Any]:
    from src.models.collab import DocRevision

    principal.require(VIEW)
    row = _page(session, page_id)
    items = session.scalars(
        select(DocRevision).where(DocRevision.page_id == row.id).order_by(DocRevision.version.desc()).limit(100)
    ).all()
    return {
        "items": [
            {"id": str(item.id), "version": item.version, "title": item.title, "note": item.note,
             "author": _person(item.author), "created_at": iso(item.created_at),
             "blocks": len(item.blocks or []), "is_current": item.version == row.version}
            for item in items
        ],
        "current_version": row.version,
    }


def _revision(session, page_row, revision_id):
    from src.models.collab import DocRevision

    item = session.get(DocRevision, parse_uuid(revision_id, field="revision_id"))
    if item is None or item.page_id != page_row.id:
        raise NotFoundError("That version of the page does not exist.")
    return item


def revision(session, page_id: Any, revision_id: Any, *, principal) -> dict[str, Any]:
    principal.require(VIEW)
    row = _page(session, page_id)
    item = _revision(session, row, revision_id)
    return {"id": str(item.id), "version": item.version, "title": item.title, "blocks": list(item.blocks or []),
            "author": _person(item.author), "created_at": iso(item.created_at), "note": item.note}


def restore(session, page_id: Any, revision_id: Any, *, principal) -> dict[str, Any]:
    """Make an old version the newest one. Nothing in between is lost."""
    principal.require(EDIT)
    row = _page(session, page_id)
    item = _revision(session, row, revision_id)
    row.title = item.title
    row.blocks = list(item.blocks or [])
    row.plain_text = plain_text(row.title, row.blocks)
    row.updated_by_id = principal.user_id
    row.updated_at = now()
    row.version += 1
    _revise(session, row, principal, note=f"Restored version {item.version}", force=True)
    _sync_mentions(session, row, principal)
    session.flush()
    session.expire(row, ["updated_by"])
    return page(session, row.id, principal=principal)


# ── links ────────────────────────────────────────────────────────────────


def _record_label(session, resource_type: str, resource_id: Any, principal) -> str:
    from src.services.records.explorer import resource_for

    resource = resource_for(resource_type, principal=principal)
    record = get_or_404(
        session,
        resource.model,
        parse_uuid(resource_id, field="resource_id"),
        "That record does not exist.",
        details={"resource_type": resource_type},
        live=True,
    )
    return resource.label_for(record)


def add_link(session, page_id: Any, payload: dict[str, Any], *, principal, source: str = "MANUAL") -> dict[str, Any]:
    from src.models.collab import DocLink

    principal.require(EDIT)
    row = _page(session, page_id)
    payload = payload or {}
    resource_type = str(payload.get("resource_type") or "")
    resource_id = str(parse_uuid(payload.get("resource_id"), field="resource_id"))
    label = _record_label(session, resource_type, resource_id, principal)
    existing = session.scalars(
        select(DocLink).where(DocLink.page_id == row.id, DocLink.resource_type == resource_type,
                              DocLink.resource_id == resource_id)
    ).first()
    if existing is None:
        existing = DocLink(page_id=row.id, resource_type=resource_type, resource_id=resource_id,
                           label=label, source=source, created_by_id=principal.user_id)
        session.add(existing)
    else:
        existing.label = label
        if existing.source == "MENTION" and source != "MENTION":
            existing.source = source
    session.flush()
    return {"links": _links(session, row.id)}


def remove_link(session, page_id: Any, link_id: Any, *, principal) -> dict[str, Any]:
    from src.models.collab import DocLink

    principal.require(EDIT)
    row = _page(session, page_id)
    link = session.get(DocLink, parse_uuid(link_id, field="link_id"))
    if link is None or link.page_id != row.id:
        raise NotFoundError("That link does not exist.")
    session.delete(link)
    session.flush()
    return {"links": _links(session, row.id)}


def _sync_mentions(session, row, principal) -> None:
    """Record blocks in the body are links; a removed block is a removed link."""
    from src.models.collab import DocLink

    mentioned = {
        (block["resource_type"], block["resource_id"]): block.get("label") or ""
        for block in row.blocks or [] if block.get("kind") == "record" and block.get("resource_id")
    }
    current = session.scalars(select(DocLink).where(DocLink.page_id == row.id)).all()
    have = {(link.resource_type, link.resource_id): link for link in current}
    for link in current:
        if link.source == "MENTION" and (link.resource_type, link.resource_id) not in mentioned:
            session.delete(link)
    for (resource_type, resource_id), label in mentioned.items():
        if (resource_type, resource_id) in have:
            continue
        try:
            label = _record_label(session, resource_type, resource_id, principal)
        except (NotFoundError, ValidationError, ForbiddenError):
            continue
        session.add(DocLink(page_id=row.id, resource_type=resource_type, resource_id=resource_id,
                            label=label, source="MENTION", created_by_id=principal.user_id))


def backlinks(session, args, *, principal) -> dict[str, Any]:
    """The pages that link to one record — what a record page lists."""
    from src.models.collab import DocLink, DocPage, DocSpace

    principal.require(VIEW)
    resource_type = str(args.get("resource_type") or "")
    resource_id = str(parse_uuid(args.get("resource_id"), field="resource_id"))
    rows = session.execute(
        select(DocPage, DocSpace, DocLink.source)
        .join(DocLink, DocLink.page_id == DocPage.id)
        .join(DocSpace, DocSpace.id == DocPage.space_id)
        .where(DocLink.resource_type == resource_type, DocLink.resource_id == resource_id,
               DocPage.deleted_at.is_(None), DocSpace.deleted_at.is_(None))
        .order_by(DocPage.updated_at.desc())
        .limit(50)
    ).all()
    return {
        "items": [
            {"id": str(item.id), "title": item.title, "icon": item.icon, "space": space.name,
             "space_id": str(space.id), "source": source, "updated_at": iso(item.updated_at),
             "is_meeting": item.event_id is not None}
            for item, space, source in rows
        ],
        "can_edit": principal.can(EDIT),
    }


# ── search ───────────────────────────────────────────────────────────────


def _snippet(text: str, term: str) -> str:
    lowered = text.lower()
    at = lowered.find(term.lower())
    if at < 0:
        return text[:160]
    start = max(0, at - 60)
    end = min(len(text), at + len(term) + 100)
    return ("…" if start else "") + text[start:end].replace("\n", " ") + ("…" if end < len(text) else "")


def search(session, args, *, principal) -> dict[str, Any]:
    from src.models.collab import DocPage, DocSpace

    principal.require(VIEW)
    term = str(args.get("q") or "").strip()
    if len(term) < 2:
        return {"items": [], "total": 0, "q": term}
    like = f"%{term}%"
    clauses = [DocPage.deleted_at.is_(None), DocSpace.deleted_at.is_(None),
               or_(DocPage.title.ilike(like), DocPage.plain_text.ilike(like))]
    if args.get("space_id"):
        clauses.append(DocPage.space_id == parse_uuid(args["space_id"], field="space_id"))
    rows = session.execute(
        select(DocPage, DocSpace)
        .join(DocSpace, DocSpace.id == DocPage.space_id)
        .where(*clauses)
        # A title hit before a body hit: somebody searching for "Runbook" wants
        # the page called that, not every page that says the word.
        .order_by(DocPage.title.ilike(like).desc(), DocPage.updated_at.desc())
        .limit(40)
    ).all()
    return {
        "items": [
            {"id": str(item.id), "title": item.title, "icon": item.icon, "space": space.name,
             "space_id": str(space.id), "snippet": _snippet(item.plain_text or "", term),
             "updated_at": iso(item.updated_at)}
            for item, space in rows
        ],
        "total": len(rows),
        "q": term,
    }


def recent(session, *, principal) -> dict[str, Any]:
    from src.models.collab import DocPage, DocSpace

    principal.require(VIEW)
    rows = session.execute(
        select(DocPage, DocSpace).join(DocSpace, DocSpace.id == DocPage.space_id)
        .where(DocPage.deleted_at.is_(None), DocSpace.deleted_at.is_(None))
        .order_by(DocPage.updated_at.desc()).limit(12)
    ).all()
    return {
        "items": [
            {"id": str(item.id), "title": item.title, "icon": item.icon, "space": space.name,
             "space_id": str(space.id), "updated_at": iso(item.updated_at),
             "updated_by": _person(item.updated_by), "is_meeting": item.event_id is not None}
            for item, space in rows
        ]
    }


# ── meeting notes ────────────────────────────────────────────────────────


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


def meeting_blocks(event) -> list[dict[str, Any]]:
    """A notes page pre-filled from the event: when, who, and what it is about."""
    when = event.starts_at.strftime("%A %-d %B %Y, %H:%M") if isinstance(event.starts_at, datetime) else ""
    people = [
        item.get("name") or item.get("email") or "Somebody"
        for item in (event.participants or []) if isinstance(item, dict)
    ]
    agenda = [line.strip(" -•*\t") for line in (event.description or "").splitlines() if line.strip(" -•*\t")]
    return [
        _b("callout", tone="info",
           text=f"**{when}**" + (f" · {event.location}" if event.location else "")),
        _b("heading", level=2, text="Attendees"),
        _b("list", ordered=False, items=people or ["Nobody was invited"]),
        _b("heading", level=2, text="Agenda"),
        _b("list", ordered=True, items=agenda or [""]),
        _b("heading", level=2, text="Notes"),
        _b("text", text=""),
        _b("heading", level=2, text="Decisions"),
        _b("list", ordered=False, items=[""]),
        _b("heading", level=2, text="Action items"),
        _b("action", text="", assignee_id=None, due_date=None, task_id=None),
    ]


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
