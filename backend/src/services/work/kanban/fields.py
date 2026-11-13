"""A card's fields, cleaned: kind, priority, labels, dates, people, checklist, parent."""

from __future__ import annotations

from datetime import date
from typing import Any
from uuid import UUID

from sqlalchemy import func, select

from src.core.errors import ValidationError
from src.core.naming import identifier, sequence_of
from src.core.pagination import parse_uuid
from src.services.work.kanban.vocabulary import KINDS, PARENT_OF, PRIORITIES


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


def _due_date(raw: Any) -> date | None:
    """A calendar day, parsed here rather than handed to the column as text.

    The raw string used to be assigned straight to the `Date` column, and the
    serialiser then called `.isoformat()` on what was still a `str` — every
    card created or edited with a due date answered 500, and a malformed one
    reached the database as a driver error.
    """
    if raw in (None, ""):
        return None
    try:
        return date.fromisoformat(str(raw)[:10])
    except ValueError as exc:
        raise ValidationError(
            "due_date must be a date (YYYY-MM-DD).", details={"due_date": raw}
        ) from exc


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
