"""The rows a selection resolves to, and what refuses them."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from uuid import UUID

from src.core.errors import ApiError, ValidationError
from src.core.pagination import parse_uuid
from src.services.records import writes as writes
from src.services.records.detail import _lookup
from src.services.records.explorer import Resource, statement_for

#: What a bulk gesture may do. Deliberately short: these are the two verbs a
#: list offers, and each maps onto a write that already exists with its own
#: permission and its own audit action.
ACTIONS = ("update", "delete")


#: The most rows one gesture may touch.
#:
#: Not a technical limit — the statement would happily update a hundred
#: thousand — but the point past which "are you sure" stops being a real
#: question. A reader who has just been told that this will change 40,000
#: records has no way to check that number, and the recovery from a wrong
#: filter is a restore. A refusal that names the cap and the count is something
#: they can act on: narrow the filter, or ask for it deliberately in pieces.
MAX_ROWS = 500


@dataclass(frozen=True)
class Selection:
    """Which records a gesture is about.

    Both halves at once, because that is what a list actually produces: a
    reader ticks three rows on page one, then presses "select everything
    matching", then unticks one. `excluded` is what makes the last of those
    expressible — without it the only way to say "all of these except that
    one" is to send four hundred and ninety-nine ids.
    """

    ids: tuple[UUID, ...]
    query: dict[str, Any] | None
    excluded: frozenset[UUID]

    @property
    def by_filter(self) -> bool:
        return self.query is not None


def _rows(session, resource: Resource, selection: Selection, *, principal) -> list[Any]:
    """The live rows a selection names, in a stable order, without duplicates.

    One list rather than a count and then a fetch: the count a reader confirmed
    and the rows a write touches have to be the same set, and two queries a
    second apart are two answers when somebody else is working.
    """
    found: dict[UUID, Any] = {}

    if selection.query is not None:
        statement = statement_for({**selection.query, "resource_type": resource.key},
                                  principal=principal)
        # One more than the cap, so "over the limit" can be reported exactly
        # without loading two hundred thousand rows to count them.
        for row in session.scalars(statement.limit(MAX_ROWS + 1)):
            found[row.id] = row

    if selection.ids:
        for row in session.scalars(_lookup(resource, list(selection.ids))):
            found[row.id] = row

    for excluded in selection.excluded:
        found.pop(excluded, None)

    return list(found.values())


def _refusals(
    resource: Resource, rows: list[Any], action: str, changes: dict[str, Any], *, principal
) -> list[dict[str, Any]]:
    """Why some of these rows cannot be touched, counted by reason.

    Counted rather than listed per row: "12 are already closed" is something a
    reader acts on, and twelve identical lines are something they scroll past.
    """
    reasons: dict[str, int] = {}

    missing = _missing_permission(action, principal=principal)
    if missing and rows:
        reasons[f"Your role does not include {missing}"] = len(rows)
        return [{"reason": reason, "count": count} for reason, count in reasons.items()]

    if action == "update":
        for row in rows:
            if all(getattr(row, name, None) == value for name, value in changes.items()):
                reasons["Already has these values"] = reasons.get("Already has these values", 0) + 1

    return [{"reason": reason, "count": count} for reason, count in sorted(reasons.items())]


def _missing_permission(action: str, *, principal) -> str:
    needed = writes.DELETE_PERMISSION if action == "delete" else writes.UPDATE_PERMISSION
    try:
        principal.require(needed)
    except ApiError:
        return needed
    return ""


def _object(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise ValidationError("The request must be a JSON object.")
    return payload


def _uuids(raw: Any, *, field: str) -> list[UUID]:
    if raw is None:
        return []
    if not isinstance(raw, list):
        raise ValidationError(f"{field} must be a list of ids.", details={field: "Expected a list."})
    return [parse_uuid(value, field=field) for value in raw]


def _action(payload: dict[str, Any]) -> str:
    action = str(_object(payload).get("action") or "").strip().lower()
    if action not in ACTIONS:
        raise ValidationError(
            "That is not something this can do to a selection.",
            details={"action": action, "allowed": list(ACTIONS)},
        )
    return action


def _changes(
    session, resource: Resource, action: str, payload: dict[str, Any]
) -> dict[str, Any]:
    """The values an update sets, coerced by the *form's* own declaration.

    `record_writes.coerce` and nothing else: a bulk edit that accepted a status
    the form refuses would be a second, weaker validator on the same column —
    and the way somebody puts a value into the database that no screen can
    produce.
    """
    if action != "update":
        return {}

    raw = _object(payload).get("changes")
    if not isinstance(raw, dict) or not raw:
        raise ValidationError(
            "An update needs at least one field to change.",
            details={"changes": "Send a field name and its new value."},
        )

    values, problems = writes.coerce(session, resource, raw, creating=False)
    if problems:
        first = problems[0]
        raise ValidationError(str(first.get("message")), details=first)
    return values
