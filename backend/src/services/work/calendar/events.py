"""One event: read, create, change, remove, respond."""

from __future__ import annotations

from typing import Any

from src.core import audit
from src.core.clock import now
from src.core.errors import ForbiddenError, ValidationError
from src.core.pagination import parse_uuid
from src.core.repository import get_or_404
from src.core.vocabulary import EVENT_RESPONSE
from src.models.business import CalendarEvent
from src.services.work.calendar.recurrence import MANAGE, VIEW
from src.services.work.calendar.serializers import _audit_state, _serialize
from src.services.work.calendar.validation import _validated


def get(session, event_id: Any, *, principal) -> dict[str, Any]:
    principal.require(VIEW)
    row = _event(session, event_id)
    return _serialize(row, principal)


def create(session, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    principal.require(MANAGE)
    values = _validated(payload, partial=False)
    row = CalendarEvent(organizer_id=getattr(principal, "user_id", None), **values)
    # The organiser is a participant, and accepted: somebody who called the
    # meeting has plainly said they are coming, and an organiser sitting in
    # their own attendee list as "no answer" is a list nobody trusts.
    row.participants = _with_organiser(row.participants, principal)
    session.add(row)
    session.flush()
    audit.record(
        session,
        action="calendar.create",
        resource_type="calendar_event",
        resource_id=row.id,
        resource_label=row.title,
        principal=principal,
        after=_audit_state(row),
    )
    return _serialize(row, principal)


def update(session, event_id: Any, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    """Change an event — and, for a series, every occurrence of it.

    Stated rather than implied: an editor that silently changed only the
    occurrence somebody clicked, or silently changed all of them, is an editor
    that loses an afternoon either way. The single-occurrence exception is a
    second table and a question nobody has asked yet (see the module docstring).
    """
    principal.require(MANAGE)
    row = _event(session, event_id)
    _require_organiser(row, principal)
    before = _audit_state(row)
    for name, value in _validated(payload, partial=True).items():
        setattr(row, name, value)
    session.flush()
    audit.record(
        session,
        action="calendar.update",
        resource_type="calendar_event",
        resource_id=row.id,
        resource_label=row.title,
        principal=principal,
        before=before,
        after=_audit_state(row),
    )
    return _serialize(row, principal)


def remove(session, event_id: Any, *, principal) -> dict[str, Any]:
    """Cancel an event.

    A soft delete *and* a cancelled status, because the two answer different
    questions: the row stays for the audit trail, and anything still reading
    the event — a project page, a report — sees that it is not happening.
    """
    principal.require(MANAGE)
    row = _event(session, event_id)
    _require_organiser(row, principal)
    row.status = "CANCELLED"
    row.deleted_at = now()
    session.flush()
    audit.record(
        session,
        action="calendar.delete",
        resource_type="calendar_event",
        resource_id=row.id,
        resource_label=row.title,
        principal=principal,
        before=_audit_state(row),
    )
    return {"deleted": True, "id": str(row.id)}


def respond(session, event_id: Any, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    """Say whether *you* are coming.

    Needs `calendar.view` and not `calendar.manage`: answering an invitation is
    not editing a calendar. And it writes only the caller's own entry — an
    organiser accepting on somebody's behalf turns an attendance list into a
    guess, which is worse than an empty one.
    """
    principal.require(VIEW)
    row = _event(session, event_id)
    me = getattr(principal, "user_id", None)
    if me is None:
        raise ForbiddenError("Only a signed-in person can answer an invitation.")

    answer = str((payload or {}).get("response") or "").strip().upper()
    if answer not in EVENT_RESPONSE:
        raise ValidationError(
            "Unknown response.",
            details={"response": answer, "allowed": list(EVENT_RESPONSE)},
        )

    entries = [dict(entry) for entry in (row.participants or []) if isinstance(entry, dict)]
    for entry in entries:
        if str(entry.get("user_id")) == str(me):
            entry["response"] = answer
            break
    else:
        raise ForbiddenError("You were not invited to this event.")

    # Reassigned rather than mutated: a JSONB column changed in place is not
    # seen as dirty by SQLAlchemy and the UPDATE never happens.
    row.participants = entries
    session.flush()
    audit.record(
        session,
        action="calendar.respond",
        resource_type="calendar_event",
        resource_id=row.id,
        resource_label=row.title,
        principal=principal,
        metadata={"response": answer},
        message=f"answered {answer.lower().replace('_', ' ')}",
    )
    return _serialize(row, principal)


def _event(session, event_id: Any) -> CalendarEvent:
    """One event by id, accepting an occurrence id for the series it belongs to.

    Deliberately tolerant: the grid hands back the id it was given, and making
    every caller remember to split on the colon is a bug waiting for the one
    call site that forgets.
    """
    raw = str(event_id or "").split(":", 1)[0]
    row = get_or_404(
        session,
        CalendarEvent,
        parse_uuid(raw, field="event_id"),
        "That event does not exist.",
        live=True,
    )
    return row


def _require_organiser(row: CalendarEvent, principal) -> None:
    """Only the organiser changes an event — or an administrator.

    An event sits in other people's weeks, so "anybody who may write to the
    calendar may rewrite yours" is the wrong default. `admin.access` is the
    exception because somebody has to be able to cancel a meeting whose
    organiser has left.
    """
    if row.organizer_id and row.organizer_id != getattr(principal, "user_id", None):
        if not principal.can("admin.access"):
            raise ForbiddenError("Only the organiser of an event can change it.")


def _with_organiser(participants: Any, principal) -> list[dict[str, Any]] | None:
    me = getattr(principal, "user_id", None)
    if me is None:
        return participants
    entries = [dict(entry) for entry in (participants or []) if isinstance(entry, dict)]
    if any(str(entry.get("user_id")) == str(me) for entry in entries):
        return entries or None
    entries.insert(
        0,
        {
            "user_id": str(me),
            "name": getattr(principal, "full_name", None),
            "email": getattr(principal, "email", None),
            "response": "ACCEPTED",
        },
    )
    return entries
