"""One gesture over many records (§43, §75).

A list that can only be changed a row at a time is a list somebody changes with
fifty clicks, and the fifty-first is the one they get wrong. So: tick some
rows, or say "everything matching what I am looking at", and apply one change.

Four decisions carry this module.

**The preview is a separate call, and it is not optional.** "Change the status
of everything matching this filter" is a sentence whose consequences the reader
cannot see — the filter might match nine rows or nine hundred, and the number
is the whole basis for deciding. §75 asks for the affected count split into
*selected by hand* and *selected by filter*, because those two are trusted
differently: somebody who ticked twelve boxes knows what is in them, and
somebody who filtered does not. The preview answers with both numbers, a few
of the actual labels, and every reason a row would be refused.

**A filter selection is resolved by the list's own query.** `explorer` already
validates a question and turns it into a statement; bulk asks it for that
statement rather than applying filters itself. A second filter implementation
is a second place for "case-insensitive" to be decided differently, and the
first time the two disagreed somebody would have changed rows they never saw.

**Partial success is the normal outcome, and it is reported as one.** Fifty
rows, one of which lost a race and one of which somebody else already deleted,
is not a failure and not a success: it is forty-eight applied and two refused,
each with the reason. Returning 200 with both halves is the only answer a
reader can act on — a 500 hides the forty-eight, and a 200 with no detail hides
the two. Each row is attempted in a savepoint, so one refusal does not roll
back the ones before it.

**The writes are the single-record writes.** `record_writes.apply_values` and
`remove_row` are what a form and a drag already use, audit included — so a
bulk of two hundred leaves two hundred ledger rows saying the same thing two
hundred single edits would have said, and a status change reads as a status
change rather than as an edit.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from uuid import UUID

from src.core.errors import ApiError, ValidationError
from src.core.pagination import parse_uuid
from src.services import record_writes as writes
from src.services.explorer import Resource, resource_for, statement_for
from src.services.records import _lookup

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

#: How many labels the preview shows.
#:
#: Enough to recognise the selection, few enough that the count stays the
#: headline. A preview that lists four hundred titles is a preview nobody
#: reads, which is the same as no preview.
SAMPLE = 5


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


def parse_selection(payload: dict[str, Any]) -> Selection:
    """Read a selection off a request body, refusing an empty one."""
    body = _object(payload)
    raw = body.get("selection") if isinstance(body.get("selection"), dict) else body
    ids = tuple(_uuids(raw.get("ids"), field="ids"))
    excluded = frozenset(_uuids(raw.get("excluded"), field="excluded"))
    query = raw.get("query") if isinstance(raw.get("query"), dict) else None

    if not ids and query is None:
        # A gesture over nothing is a mistake somewhere upstream, and applying
        # it silently to zero rows would report "0 changed" as a success.
        raise ValidationError(
            "Nothing is selected.",
            details={"selection": "Send ids, a query, or both."},
        )
    return Selection(ids=ids, query=query, excluded=excluded)


def preview(session, resource_type: Any, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    """What this gesture would do, before it does it (§75)."""
    resource = resource_for(resource_type, principal=principal)
    selection = parse_selection(payload)
    action = _action(payload)
    # Validated here so a malformed change is a bad request on the *preview*,
    # which is where the reader still has the form open.
    changes = _changes(session, resource, action, payload)

    rows = _rows(session, resource, selection, principal=principal)
    by_hand = [row for row in rows if row.id in set(selection.ids)]
    counts = {
        "total": len(rows),
        "by_hand": len(by_hand),
        # The rows only the filter chose. Reported separately because the two
        # are trusted differently: ticking a box is knowing what is in it.
        "by_filter": len(rows) - len(by_hand),
    }

    refusals = _refusals(resource, rows, action, changes, principal=principal)
    return {
        "resource_type": resource.key,
        "action": action,
        "changes": {name: _plain(value) for name, value in changes.items()},
        **counts,
        "limit": MAX_ROWS,
        # Over the cap is reported rather than raised: the reader needs the
        # number to know how much to narrow by, and an error body is a worse
        # place to read it than the dialog they are already looking at.
        "over_limit": len(rows) > MAX_ROWS,
        "sample": [
            {"id": str(row.id), "title": resource.label_for(row)} for row in rows[:SAMPLE]
        ],
        "refused": refusals,
        "eligible": len(rows) - sum(reason["count"] for reason in refusals),
        "describes": _describes(resource, selection, counts),
    }


def apply(session, resource_type: Any, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    """Do it, and report both halves of what happened (§43)."""
    resource = resource_for(resource_type, principal=principal)
    selection = parse_selection(payload)
    action = _action(payload)
    changes = _changes(session, resource, action, payload)

    # The permission is required once, before anything is touched. Per row it
    # would be the same answer every time, and a gesture that changed the first
    # forty rows and then discovered it was not allowed is worse than one that
    # never started.
    principal.require(
        writes.DELETE_PERMISSION if action == "delete" else writes.UPDATE_PERMISSION
    )

    rows = _rows(session, resource, selection, principal=principal)
    if len(rows) > MAX_ROWS:
        raise ValidationError(
            f"That would change {len(rows)} records, and {MAX_ROWS} is the most one "
            "action may touch. Narrow the selection.",
            details={"matched": len(rows), "limit": MAX_ROWS},
        )

    applied: list[dict[str, Any]] = []
    unchanged: list[dict[str, Any]] = []
    failed: list[dict[str, Any]] = []

    for row in rows:
        entry = {"id": str(row.id), "title": resource.label_for(row)}
        # A savepoint per row, so one refusal does not undo the rows before it.
        # Without it a single lost race turns forty-nine applied writes into
        # nothing, and the reader is told "1 failed" about a list that did not
        # change at all.
        nested = session.begin_nested()
        try:
            if action == "delete":
                writes.remove_row(session, resource, row, principal=principal)
                applied.append(entry)
            else:
                moved = writes.apply_values(
                    session, resource, row, dict(changes), principal=principal
                )
                (applied if moved else unchanged).append(entry)
            nested.commit()
        except ApiError as error:
            nested.rollback()
            failed.append({**entry, "error": error.code, "message": str(error.message)})

    return {
        "resource_type": resource.key,
        "action": action,
        "requested": len(rows),
        "applied": len(applied),
        # Not a failure and not a change: a row that already had the value.
        # Folding these into "applied" would report a no-op as work done, and
        # folding them into "failed" would report it as a problem.
        "unchanged": len(unchanged),
        "failed": failed,
        "records": applied[:SAMPLE],
        "message": _outcome(resource, action, len(applied), len(unchanged), failed),
    }


# ── resolution ───────────────────────────────────────────────────────────


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


# ── request parsing ──────────────────────────────────────────────────────


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


# ── words ────────────────────────────────────────────────────────────────


def _plain(value: Any) -> Any:
    from src.services.explorer import _json_value

    return _json_value(value)


def _describes(resource: Resource, selection: Selection, counts: dict[str, int]) -> str:
    """The selection in a sentence, for the confirmation the reader reads."""
    total = counts["total"]
    noun = resource.label.lower() if total != 1 else resource.label.rstrip("s").lower()
    if not selection.by_filter:
        return f"{total} {noun} you selected"
    if counts["by_hand"]:
        return (
            f"{total} {noun} — {counts['by_hand']} you selected "
            f"and {counts['by_filter']} matching the filter"
        )
    return f"{total} {noun} matching the filter"


def _outcome(
    resource: Resource, action: str, applied: int, unchanged: int, failed: list[dict[str, Any]]
) -> str:
    """Both halves in one sentence, because a reader reads the sentence."""
    verb = "deleted" if action == "delete" else "updated"
    noun = resource.label.lower() if applied != 1 else resource.label.rstrip("s").lower()
    parts = [f"{verb.capitalize()} {applied} {noun}"]
    if unchanged:
        parts.append(f"{unchanged} already had those values")
    if failed:
        parts.append(f"{len(failed)} could not be {verb}")
    return "; ".join(parts) + "."
