"""Creating, changing and removing boards."""

from __future__ import annotations

from typing import Any

from sqlalchemy import select

from src.core import sharing
from src.core.clock import now
from src.core.errors import ConflictError, ValidationError
from src.services.work.kanban.access import _board_row
from src.services.work.kanban.serializers import _board
from src.services.work.kanban.vocabulary import (
    MANAGE_PERMISSION,
    RESOURCE,
    SHARE_PERMISSION,
    STARTER_LANES,
)


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
