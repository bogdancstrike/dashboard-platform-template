"""Kanban boards (§18): a workspace whose columns are somebody's own.

**Why this is a second board.** `/tasks` is a view of the work queue and its
lanes are the declared `TASK_STATUS` vocabulary — the same values every filter,
chart and report reads. A lane invented there would be a status nothing else
has heard of, and a card in it would vanish from every report that counts by
status. This is the other thing people mean by a board: columns they name,
reorder and put limits on. See `models/kanban` for what that costs.

Five decisions worth stating.

**Order is dense integers, rewritten on a drop.** A float midpoint avoids
touching neighbours and drifts into precision nobody can debug; dense integers
mean a drop rewrites the cards after it *in that lane* — a handful of rows,
always readable in psql, and impossible to get into a state where two cards
claim the same place.

**A lane is deleted by moving its cards, never by cascading.** `lane_id` is
nullable so the database *can* orphan a card, and this service never does:
removing a lane hands its cards to another one. Losing somebody's work to a
column they were tidying up is the single worst thing a board can do.

**The hierarchy is one rule in one place.** An epic parents stories; a story
parents tasks and bugs; nothing parents an epic. Written as `PARENT_OF` below,
so a card cannot be made its own grandparent and the error says which pairing
was refused.

**A WIP limit warns, and never refuses.** A limit somebody set last month must
not stop them moving an urgent card today — a board that argues gets worked
around, in a spreadsheet. The count and the limit are both published; saying
"this lane is over its limit" is the board's job and stopping the work is not.

**Sharing is `core/sharing`, not a second model.** A board is shared exactly as
a saved search is: private, named members, or everyone signed in, with
owner-only writes.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import Select, func, or_, select

from src.core import sharing
from src.core.clock import iso, now
from src.core.errors import ConflictError, NotFoundError, ValidationError
from src.core.naming import identifier, initials, sequence_of
from src.core.pagination import parse_uuid

RESOURCE = "kanban_board"

#: Reading a board needs the same permission as reading a record; making one is
#: a workspace of your own, which is what `dashboards.manage` already means.
VIEW_PERMISSION = "records.view"
MANAGE_PERMISSION = "dashboards.manage"
SHARE_PERMISSION = "searches.share"

#: What a card can be, and what each kind may hold. `()` means it holds
#: nothing — a task has no children, and a bug is not a container.
#:
#: One table rather than a check per call site: "can this be dropped on that"
#: is asked when a card is created, when it is re-parented and when a parent is
#: deleted, and three copies of a rule about hierarchy is how a board ends up
#: with an epic inside a task.
PARENT_OF: dict[str, tuple[str, ...]] = {
    "EPIC": ("STORY",),
    "STORY": ("TASK", "BUG"),
    "TASK": (),
    "BUG": (),
}

KINDS: tuple[str, ...] = tuple(PARENT_OF)

PRIORITIES: tuple[str, ...] = ("LOW", "NORMAL", "HIGH", "CRITICAL")

#: The lanes a new board starts with. A board created empty is a board whose
#: first action is administration rather than work.
STARTER_LANES: tuple[tuple[str, bool], ...] = (
    ("Backlog", False),
    ("Selected", False),
    ("In progress", False),
    ("In review", False),
    ("Done", True),
)

#: A ceiling on lanes, because a board with forty columns is a spreadsheet.
MAX_LANES = 20
#: How many cards a lane returns before the reader has to narrow. A lane is
#: read, not paged through.
CARDS_PER_LANE = 100


# ── reading ──────────────────────────────────────────────────────────────


def _visible(principal) -> Any:
    from src.models.kanban import Board

    return sharing.visibility(Board, RESOURCE, principal)


def _board_statement(principal) -> Select:
    from src.models.kanban import Board

    return select(Board).where(Board.deleted_at.is_(None), _visible(principal))


def boards(session, args, *, principal) -> dict[str, Any]:
    """Every board this reader may open, newest first.

    Archived ones only when asked for: a board somebody finished with is not
    deleted — the cards on it are a record — but it is not what they came for
    either.
    """
    principal.require(VIEW_PERMISSION)
    from src.models.kanban import Board, BoardCard

    include_archived = str(args.get("archived") or "").lower() in ("1", "true", "yes")
    statement = _board_statement(principal)
    if not include_archived:
        statement = statement.where(Board.is_archived.is_(False))

    rows = session.scalars(statement.order_by(Board.created_at.desc())).all()
    counts = dict(
        session.execute(
            select(BoardCard.board_id, func.count())
            .where(
                BoardCard.deleted_at.is_(None),
                BoardCard.board_id.in_([row.id for row in rows] or [None]),
            )
            .group_by(BoardCard.board_id)
        ).all()
    )

    return {
        "items": [_board(row, principal, cards=int(counts.get(row.id, 0))) for row in rows],
        "total": len(rows),
        "can_create": principal.can(MANAGE_PERMISSION),
        "kinds": [{"key": kind, "children": list(PARENT_OF[kind])} for kind in KINDS],
        "priorities": list(PRIORITIES),
    }


def board(session, board_id: Any, args, *, principal) -> dict[str, Any]:
    """One board: its lanes, the cards in each, and what may be filtered.

    The filters are applied in SQL and the *counts* are per lane over the
    whole match — so "In progress (12)" means twelve of the cards this reader
    asked about, not twelve of the ones that fitted on screen (§71).
    """
    principal.require(VIEW_PERMISSION)
    from src.models.kanban import BoardCard

    row = _board_row(session, board_id, principal)
    assignee = (args.get("assignee_id") or "").strip()
    label = (args.get("label") or "").strip()
    kind = _kind(args.get("kind")) if args.get("kind") else ""
    term = (args.get("q") or "").strip()

    def scoped() -> Select:
        statement = select(BoardCard).where(
            BoardCard.board_id == row.id, BoardCard.deleted_at.is_(None)
        )
        if assignee:
            statement = statement.where(
                BoardCard.assignee_id == parse_uuid(assignee, field="assignee_id")
            )
        if label:
            statement = statement.where(BoardCard.labels.any(label))
        if kind:
            statement = statement.where(BoardCard.kind == kind)
        if term:
            like = f"%{term}%"
            statement = statement.where(
                or_(
                    BoardCard.title.ilike(like),
                    BoardCard.reference.ilike(like),
                    BoardCard.description.ilike(like),
                )
            )
        return statement

    matched = scoped()
    counts = dict(
        session.execute(
            matched.with_only_columns(BoardCard.lane_id, func.count()).group_by(BoardCard.lane_id)
        ).all()
    )
    cards = session.scalars(
        matched.order_by(BoardCard.position.asc(), BoardCard.created_at.asc())
    ).all()

    by_lane: dict[Any, list[Any]] = {}
    for item in cards:
        by_lane.setdefault(item.lane_id, []).append(item)

    # Every label in use on this board, so the filter offers what is there
    # rather than a free-text box that matches nothing.
    labels = sorted(
        {
            value
            for item in session.scalars(
                select(BoardCard).where(
                    BoardCard.board_id == row.id, BoardCard.deleted_at.is_(None)
                )
            ).all()
            for value in (item.labels or [])
        }
    )

    return {
        "board": _board(row, principal, cards=len(cards)),
        "lanes": [
            {
                "id": str(lane.id),
                "name": lane.name,
                "position": lane.position,
                "wip_limit": lane.wip_limit,
                "is_done": bool(lane.is_done),
                # The whole match, not the slice returned — see the docstring.
                "total": int(counts.get(lane.id, 0)),
                # A limit warns; it never refuses. Published so the board can
                # say so without this service deciding what to do about it.
                "over_limit": bool(
                    lane.wip_limit is not None and int(counts.get(lane.id, 0)) > lane.wip_limit
                ),
                "cards": [_card(item) for item in by_lane.get(lane.id, [])[:CARDS_PER_LANE]],
            }
            for lane in row.lanes
            if lane.deleted_at is None
        ],
        # A card whose lane was removed while somebody was looking at the page.
        # Shown rather than hidden: it is work, and work that is nowhere is
        # exactly what somebody needs to see.
        "unplaced": [_card(item) for item in by_lane.get(None, [])],
        "labels": labels,
        "kinds": [{"key": name, "children": list(PARENT_OF[name])} for name in KINDS],
        "priorities": list(PRIORITIES),
        "filters": {"assignee_id": assignee, "label": label, "kind": kind, "q": term},
    }


def card(session, card_id: Any, *, principal) -> dict[str, Any]:
    """One card, with the board it is on and the family around it."""
    principal.require(VIEW_PERMISSION)
    from src.models.kanban import BoardCard

    row = _card_row(session, card_id, principal)
    parent = session.get(BoardCard, row.parent_id) if row.parent_id else None
    children = session.scalars(
        select(BoardCard)
        .where(BoardCard.parent_id == row.id, BoardCard.deleted_at.is_(None))
        .order_by(BoardCard.position.asc())
    ).all()
    board_row = _board_row(session, row.board_id, principal)

    return {
        **_card(row),
        "board": _board(board_row, principal),
        "lanes": [
            {"id": str(lane.id), "name": lane.name, "is_done": bool(lane.is_done)}
            for lane in board_row.lanes
            if lane.deleted_at is None
        ],
        "parent": _card(parent) if parent and parent.deleted_at is None else None,
        "children": [_card(child) for child in children],
        # What this card *may* be given as a parent, from the one rule.
        "parent_options": [_card(option) for option in _possible_parents(session, row)],
        "can_edit": _writable(board_row, principal),
    }


def _possible_parents(session, row) -> list[Any]:
    from src.models.kanban import BoardCard

    wanted = [kind for kind, children in PARENT_OF.items() if row.kind in children]
    if not wanted:
        return []
    return list(
        session.scalars(
            select(BoardCard)
            .where(
                BoardCard.board_id == row.board_id,
                BoardCard.deleted_at.is_(None),
                BoardCard.kind.in_(wanted),
                BoardCard.id != row.id,
            )
            .order_by(BoardCard.reference.asc())
        ).all()
    )


# ── writing: boards ──────────────────────────────────────────────────────


def create_board(session, payload: Any, *, principal) -> dict[str, Any]:
    principal.require(MANAGE_PERMISSION)
    from src.core import audit
    from src.models.kanban import Board, BoardLane

    body = payload if isinstance(payload, dict) else {}
    name = str(body.get("name") or "").strip()
    if not name:
        raise ValidationError("A board needs a name.")

    scope = sharing.scope_of(
        body.get("scope"), principal=principal, share_permission=SHARE_PERMISSION
    )
    row = Board(
        key=_board_key(session, body.get("key"), name),
        name=name[:160],
        description=str(body.get("description") or "").strip() or None,
        owner_id=principal.user_id,
        organization_id=principal.organization_id,
        scope=scope,
    )
    session.add(row)
    session.flush()

    # Started with lanes: a board created empty is a board whose first action
    # is administration rather than work.
    for position, (lane_name, is_done) in enumerate(STARTER_LANES):
        session.add(
            BoardLane(board_id=row.id, name=lane_name, position=position, is_done=is_done)
        )
    session.flush()

    sharing.replace_members(
        session,
        RESOURCE,
        row.id,
        sharing.requested_members(body),
        principal=principal,
        owner_id=principal.user_id,
    )
    audit.record(
        session,
        action="CREATE",
        resource_type="kanban_board",
        resource_id=row.id,
        resource_label=row.name,
        principal=principal,
        after={"name": row.name, "key": row.key, "scope": row.scope},
    )
    session.refresh(row)
    return _board(row, principal, cards=0)


def update_board(session, board_id: Any, payload: Any, *, principal) -> dict[str, Any]:
    from src.core import audit

    row = _board_row(session, board_id, principal)
    sharing.require_owner(row, principal, kind="board")
    body = payload if isinstance(payload, dict) else {}
    before = {"name": row.name, "scope": row.scope, "is_archived": row.is_archived}

    if "name" in body:
        name = str(body.get("name") or "").strip()
        if not name:
            raise ValidationError("A board needs a name.")
        row.name = name[:160]
    if "description" in body:
        row.description = str(body.get("description") or "").strip() or None
    if "is_archived" in body:
        row.is_archived = bool(body.get("is_archived"))
    if "scope" in body:
        row.scope = sharing.scope_of(
            body.get("scope"),
            current=row.scope,
            principal=principal,
            share_permission=SHARE_PERMISSION,
        )
    if "member_ids" in body:
        sharing.replace_members(
            session,
            RESOURCE,
            row.id,
            sharing.requested_members(body),
            principal=principal,
            owner_id=principal.user_id,
        )
    session.flush()
    audit.record(
        session,
        action="UPDATE",
        resource_type="kanban_board",
        resource_id=row.id,
        resource_label=row.name,
        principal=principal,
        before=before,
        after={"name": row.name, "scope": row.scope, "is_archived": row.is_archived},
    )
    return _board(row, principal)


def remove_board(session, board_id: Any, *, principal) -> dict[str, Any]:
    from src.core import audit

    row = _board_row(session, board_id, principal)
    sharing.require_owner(row, principal, kind="board")
    row.deleted_at = now()
    session.flush()
    audit.record(
        session,
        action="DELETE",
        resource_type="kanban_board",
        resource_id=row.id,
        resource_label=row.name,
        principal=principal,
    )
    return {"id": str(row.id), "name": row.name, "deleted": True}


# ── writing: lanes ───────────────────────────────────────────────────────


def create_lane(session, board_id: Any, payload: Any, *, principal) -> dict[str, Any]:
    """A column somebody named. The thing `/tasks` deliberately cannot do."""
    from src.models.kanban import BoardLane

    row = _board_row(session, board_id, principal)
    _require_writable(row, principal)
    body = payload if isinstance(payload, dict) else {}

    live = [lane for lane in row.lanes if lane.deleted_at is None]
    if len(live) >= MAX_LANES:
        raise ConflictError(
            f"A board holds at most {MAX_LANES} lanes.", details={"lanes": len(live)}
        )

    name = str(body.get("name") or "").strip()
    if not name:
        raise ValidationError("A lane needs a name.")

    is_done = bool(body.get("is_done"))
    if is_done:
        _clear_done(live)

    lane = BoardLane(
        board_id=row.id,
        name=name[:80],
        position=max((item.position for item in live), default=-1) + 1,
        wip_limit=_wip_limit(body.get("wip_limit")),
        is_done=is_done,
    )
    session.add(lane)
    session.flush()
    return _lane(lane)


def update_lane(session, lane_id: Any, payload: Any, *, principal) -> dict[str, Any]:
    row = _lane_row(session, lane_id, principal)
    board_row = _board_row(session, row.board_id, principal)
    _require_writable(board_row, principal)
    body = payload if isinstance(payload, dict) else {}

    if "name" in body:
        name = str(body.get("name") or "").strip()
        if not name:
            raise ValidationError("A lane needs a name.")
        row.name = name[:80]
    if "wip_limit" in body:
        row.wip_limit = _wip_limit(body.get("wip_limit"))
    if "is_done" in body:
        wanted = bool(body.get("is_done"))
        if wanted:
            # One "done" per board: two of them is two answers to "how much
            # have we shipped".
            _clear_done([lane for lane in board_row.lanes if lane.deleted_at is None])
        row.is_done = wanted
    session.flush()
    return _lane(row)


def remove_lane(session, lane_id: Any, args: Any, *, principal) -> dict[str, Any]:
    """Delete a lane, having moved its cards somewhere they can be found.

    Never a cascade. Losing somebody's work to a column they were tidying up
    is the single worst thing a board can do, so the destination is either
    named by the caller or is the lane to the left.

    Taken from the query string rather than a body: a `DELETE` with a body is
    carried unevenly by proxies and by every HTTP client in the stack — and
    `?move_to=` is a destination somebody can read in a log line.
    """
    from src.models.kanban import BoardCard

    row = _lane_row(session, lane_id, principal)
    board_row = _board_row(session, row.board_id, principal)
    _require_writable(board_row, principal)

    live = [lane for lane in board_row.lanes if lane.deleted_at is None and lane.id != row.id]
    if not live:
        raise ConflictError(
            "A board keeps at least one lane; its cards would have nowhere to go.",
            details={"lane": str(row.id)},
        )

    requested = str((args or {}).get("move_to") or "").strip()
    if requested:
        destination = next((lane for lane in live if str(lane.id) == requested), None)
        if destination is None:
            raise ValidationError(
                "That lane is not on this board.", details={"move_to": requested}
            )
    else:
        # The lane to the left, or the first one — wherever a reader would
        # look for the work next.
        earlier = [lane for lane in live if lane.position < row.position]
        destination = max(earlier, key=lambda lane: lane.position) if earlier else live[0]

    moved = session.scalars(
        select(BoardCard).where(BoardCard.lane_id == row.id, BoardCard.deleted_at.is_(None))
    ).all()
    tail = _next_position(session, destination.id)
    for offset, card_row in enumerate(moved):
        card_row.lane_id = destination.id
        card_row.position = tail + offset

    row.deleted_at = now()
    session.flush()
    return {
        "id": str(row.id),
        "deleted": True,
        "moved": len(moved),
        "moved_to": {"id": str(destination.id), "name": destination.name},
    }


def arrange_lanes(session, board_id: Any, payload: Any, *, principal) -> dict[str, Any]:
    """The whole column order at once, not one swap at a time.

    Sent whole because a drag produces one new order, and applying it as a
    series of swaps is a series of states a concurrent reader can observe —
    including ones where two lanes share a position.
    """
    row = _board_row(session, board_id, principal)
    _require_writable(row, principal)

    body = payload if isinstance(payload, dict) else {}
    order = body.get("lane_ids")
    if not isinstance(order, list) or not order:
        raise ValidationError("lane_ids must be the board's lanes in their new order.")

    live = {str(lane.id): lane for lane in row.lanes if lane.deleted_at is None}
    wanted = [str(item) for item in order]
    if set(wanted) != set(live):
        raise ValidationError(
            "lane_ids must name every lane on the board exactly once.",
            details={"expected": sorted(live), "received": wanted},
        )

    for position, lane_id in enumerate(wanted):
        live[lane_id].position = position
    session.flush()
    return {"lanes": [_lane(live[lane_id]) for lane_id in wanted]}


# ── writing: cards ───────────────────────────────────────────────────────


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
        due_date=body.get("due_date") or None,
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
        row.due_date = body.get("due_date") or None
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


def move_card(session, card_id: Any, payload: Any, *, principal) -> dict[str, Any]:
    """Put a card in a lane at a position, and renumber what it displaced.

    Dense integers, rewritten within the two lanes involved. A float midpoint
    would avoid the rewrite and drift into precision nobody can debug; this
    touches a handful of rows and can never leave two cards claiming one place.
    """
    from src.core import audit
    from src.models.kanban import BoardCard

    row = _card_row(session, card_id, principal)
    board_row = _board_row(session, row.board_id, principal)
    _require_writable(board_row, principal)
    body = payload if isinstance(payload, dict) else {}

    lane = _lane_for(board_row, body.get("lane_id") or row.lane_id)
    try:
        index = max(0, int(body.get("position", 0)))
    except (TypeError, ValueError) as exc:
        raise ValidationError("position must be an integer.") from exc

    was = {"lane_id": row.lane_id, "position": row.position}
    siblings = list(
        session.scalars(
            select(BoardCard)
            .where(
                BoardCard.lane_id == lane.id,
                BoardCard.deleted_at.is_(None),
                BoardCard.id != row.id,
            )
            .order_by(BoardCard.position.asc(), BoardCard.created_at.asc())
        ).all()
    )
    siblings.insert(min(index, len(siblings)), row)

    row.lane_id = lane.id
    for position, item in enumerate(siblings):
        item.position = position

    # Arriving in the "done" lane is a completion, and leaving it undoes one:
    # a board whose `completed_at` disagreed with its columns would report a
    # different number from the one on screen.
    if lane.is_done and row.completed_at is None:
        row.completed_at = now()
    elif not lane.is_done and row.completed_at is not None:
        row.completed_at = None
    if not lane.is_done and row.started_at is None and lane.position > 0:
        row.started_at = now()

    # Renumber the lane it left, so a gap does not become a permanent one.
    if was["lane_id"] and was["lane_id"] != lane.id:
        _renumber(session, was["lane_id"])

    session.flush()
    audit.record(
        session,
        action="STATUS_CHANGE",
        resource_type="kanban_card",
        resource_id=row.id,
        resource_label=f"{row.reference} {row.title}",
        principal=principal,
        before={"lane": str(was["lane_id"]), "position": was["position"]},
        after={"lane": str(lane.id), "position": row.position},
        message=f"moved {row.reference} to {lane.name}",
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


# ── helpers ──────────────────────────────────────────────────────────────


def _renumber(session, lane_id) -> None:
    """Make a lane's positions dense again after something left it."""
    from src.models.kanban import BoardCard

    rows = session.scalars(
        select(BoardCard)
        .where(BoardCard.lane_id == lane_id, BoardCard.deleted_at.is_(None))
        .order_by(BoardCard.position.asc(), BoardCard.created_at.asc())
    ).all()
    for position, row in enumerate(rows):
        row.position = position


def _next_position(session, lane_id) -> int:
    from src.models.kanban import BoardCard

    highest = session.scalar(
        select(func.max(BoardCard.position)).where(
            BoardCard.lane_id == lane_id, BoardCard.deleted_at.is_(None)
        )
    )
    return int(highest) + 1 if highest is not None else 0


def _next_reference(session, board_row) -> str:
    """`PLAT-00042`, from the highest one ever issued *under this key*.

    Under the key, not on the board — which is not the same thing, and the
    difference was a 500. A reference is globally unique so it can be quoted
    without naming the board; a key is freed when a board is deleted; so a new
    board reusing a key started numbering at 1 and collided with the cards of
    the deleted board that had used it. Counting from the key covers both.

    `MAX(reference)` works because `core/naming` pads the number, which is
    what keeps the identifiers lexicographically ordered — the same reason
    every other reference in the platform is padded. Soft-deleted cards are
    included on purpose: their references are spent.
    """
    from src.models.kanban import BoardCard

    highest = session.scalar(
        select(func.max(BoardCard.reference)).where(
            BoardCard.reference.like(f"{board_row.key}-%")
        )
    )
    return identifier(board_row.key, sequence_of(highest, prefix=board_row.key) + 1)


def _board_key(session, requested: Any, name: str) -> str:
    """A short handle for the board's card references.

    Derived from the name when nobody chose one, because being asked for a
    "key" before the board exists is a question about implementation.
    """
    from src.models.kanban import Board

    # Read from the column rather than typed here: it is the real bound on both
    # the stem and the suffix, and a second copy of "12" is a second place to
    # change when the column changes.
    width = Board.key.type.length or 12

    raw = str(requested or "").strip().upper()
    if not raw:
        letters = [word[0] for word in name.upper().split() if word[:1].isalpha()]
        raw = ("".join(letters) or name.upper())[:4] or "BOARD"
    key = "".join(char for char in raw if char.isalnum())[:width] or "BOARD"

    # Every key ever used, including deleted boards'. Two boards may not share
    # a key even across time: their card references would interleave, and a
    # reader quoting `PLAT-00042` would have two candidates. `_next_reference`
    # counts from the key for the same reason.
    taken = set(session.scalars(select(Board.key)).all())
    if key not in taken:
        return key

    # The suffix grows for as long as it *fits*, trimming the stem only when it
    # has to, rather than stopping at two digits.
    #
    # The earlier version tried `KEY2` … `KEY99` and then refused, which put a
    # hard ceiling of 98 boards on any one derived key — and because a key is
    # never freed, not even by deleting the board (see above), the ceiling is
    # cumulative over the installation's whole life. The end-to-end suite makes
    # a board called "E2E board start" on every run, so it reached `EBS99` and
    # every run after that could not create a board at all. The failure was a
    # modal that stayed open.
    #
    # Bounded by the number of keys already taken: the candidates are distinct,
    # so one of the first `len(taken) + 1` of them is free. That is a proof of
    # termination rather than an arbitrary limit, and for a three-letter stem in
    # a twelve-character column it never comes close to the width.
    for number in range(2, len(taken) + 3):
        suffix = str(number)
        if len(suffix) >= width:
            break
        candidate = f"{key[: width - len(suffix)]}{suffix}"
        if candidate not in taken:
            return candidate
    raise ConflictError("Could not find a free board key.", details={"key": key})


def _clear_done(lanes) -> None:
    for lane in lanes:
        lane.is_done = False


def _wip_limit(raw: Any) -> int | None:
    if raw in (None, ""):
        return None
    try:
        value = int(raw)
    except (TypeError, ValueError) as exc:
        raise ValidationError("wip_limit must be a whole number.") from exc
    if value < 1:
        # Zero would be a lane nothing may enter, which is not a limit.
        raise ValidationError("A work-in-progress limit is at least 1, or nothing at all.")
    return value


def _kind(raw: Any) -> str:
    value = str(raw or "").strip().upper()
    if value not in PARENT_OF:
        raise ValidationError(
            "That is not a card kind.", details={"kind": value, "allowed": list(KINDS)}
        )
    return value


def _priority(raw: Any) -> str:
    value = str(raw or "").strip().upper()
    if value not in PRIORITIES:
        raise ValidationError(
            "That is not a priority.", details={"priority": value, "allowed": list(PRIORITIES)}
        )
    return value


def _labels(raw: Any) -> list[str]:
    if raw in (None, ""):
        return []
    if not isinstance(raw, list):
        raise ValidationError("labels must be an array of strings.")
    return sorted({str(item).strip()[:40] for item in raw if str(item).strip()})


def _person(raw: Any) -> UUID | None:
    return parse_uuid(raw, field="assignee_id") if raw not in (None, "") else None


def _checklist(raw: Any) -> list[dict[str, Any]]:
    """The same shape `tasks.checklist` uses, so one control edits both."""
    if raw in (None, ""):
        return []
    if not isinstance(raw, list):
        raise ValidationError("checklist must be an array of items.")
    out: list[dict[str, Any]] = []
    for item in raw:
        if not isinstance(item, dict):
            raise ValidationError("Each checklist item is an object with `text` and `done`.")
        text = str(item.get("text") or "").strip()
        if not text:
            continue
        out.append({"text": text[:240], "done": bool(item.get("done"))})
    return out


def _lane_for(board_row, raw: Any):
    """The lane named, or the leftmost one — never nothing."""
    live = [lane for lane in board_row.lanes if lane.deleted_at is None]
    if not live:
        raise ConflictError("That board has no lanes.", details={"board": str(board_row.id)})
    if raw in (None, ""):
        return min(live, key=lambda lane: lane.position)
    wanted = str(raw)
    lane = next((item for item in live if str(item.id) == wanted), None)
    if lane is None:
        raise ValidationError("That lane is not on this board.", details={"lane_id": wanted})
    return lane


def _parent_for(session, board_row, raw: Any, kind: str):
    """The parent named, checked against the one hierarchy rule."""
    from src.models.kanban import BoardCard

    if raw in (None, ""):
        return None
    wanted = parse_uuid(raw, field="parent_id")
    parent = session.scalars(
        select(BoardCard).where(
            BoardCard.id == wanted,
            BoardCard.board_id == board_row.id,
            BoardCard.deleted_at.is_(None),
        )
    ).one_or_none()
    if parent is None:
        raise ValidationError(
            "That parent is not on this board.", details={"parent_id": str(wanted)}
        )
    if kind not in PARENT_OF.get(parent.kind, ()):
        raise ValidationError(
            f"A {parent.kind.lower()} cannot hold a {kind.lower()}.",
            details={
                "parent": parent.kind,
                "child": kind,
                "allowed": list(PARENT_OF.get(parent.kind, ())),
            },
        )
    return parent


def _writable(board_row, principal) -> bool:
    return bool(board_row.owner_id == principal.user_id and principal.can(MANAGE_PERMISSION))


def _require_writable(board_row, principal) -> None:
    principal.require(MANAGE_PERMISSION)
    sharing.require_owner(board_row, principal, kind="board")


def _board_row(session, board_id: Any, principal):
    from src.models.kanban import Board

    wanted = parse_uuid(board_id, field="board_id")
    row = session.scalars(
        select(Board).where(
            Board.id == wanted, Board.deleted_at.is_(None), _visible(principal)
        )
    ).one_or_none()
    if row is None:
        raise NotFoundError("That board does not exist.", details={"id": str(wanted)})
    return row


def _lane_row(session, lane_id: Any, principal):
    from src.models.kanban import BoardLane

    wanted = parse_uuid(lane_id, field="lane_id")
    row = session.scalars(
        select(BoardLane).where(BoardLane.id == wanted, BoardLane.deleted_at.is_(None))
    ).one_or_none()
    if row is None:
        raise NotFoundError("That lane does not exist.", details={"id": str(wanted)})
    _board_row(session, row.board_id, principal)
    return row


def _card_row(session, card_id: Any, principal):
    from src.models.kanban import BoardCard

    wanted = parse_uuid(card_id, field="card_id")
    row = session.scalars(
        select(BoardCard).where(BoardCard.id == wanted, BoardCard.deleted_at.is_(None))
    ).one_or_none()
    if row is None:
        raise NotFoundError("That card does not exist.", details={"id": str(wanted)})
    # Reading a card is reading its board: one visibility rule, not two.
    _board_row(session, row.board_id, principal)
    return row


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


def _card(row) -> dict[str, Any]:
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
        "created_at": iso(row.created_at) if row.created_at else None,
        "updated_at": iso(row.updated_at) if row.updated_at else None,
    }
