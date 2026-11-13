"""Restoring a version."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from src.core.clock import now
from src.core.errors import ValidationError
from src.services.records.versions.history_view import _number, build, history
from src.services.records.versions.subjects import RESTORE_PERMISSION, Subject, _subject


def restore(session, resource_type: str, record_id: Any, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    """Put a version back — all of it, or the fields named — as one audited write."""
    if not isinstance(payload, dict):
        raise ValidationError("The request must be a JSON object.")
    subject = _subject(session, str(resource_type), record_id, principal=principal)
    principal.require(subject.edit_permission, RESTORE_PERMISSION)
    _refuse_lost_race(subject, payload.get("expected_updated_at"))

    versions = build(session, subject)
    number = _number(payload.get("version"), versions, "version", default=None)
    target = versions[number - 1]
    chosen = payload.get("fields")
    if chosen is None:
        names = list(subject.fields)
    else:
        if not isinstance(chosen, list) or not chosen:
            raise ValidationError("fields must be a non-empty list.", details={"field": "fields"})
        unknown = sorted(set(map(str, chosen)) - set(subject.fields))
        if unknown:
            raise ValidationError("Those fields are not versioned.",
                                  details={"fields": unknown, "versioned": sorted(subject.fields)})
        names = [str(name) for name in chosen]
    values = {name: target["state"].get(name) for name in names
              if target["state"].get(name) != subject.current.get(name)}
    if not values:
        return {"restored": [], "version": number,
                "message": f"Nothing to restore — the record already matches version {number}.",
                "history": history(session, subject.key, subject.row.id, {}, principal=principal)}
    # A required field cannot be restored to empty; say which, rather than
    # letting coercion report it as if the reader had typed a blank.
    label = ", ".join(subject.fields[n]["label"].lower() for n in sorted(values))
    whole = chosen is None
    message = (f"restored {subject.title} to version {number}" if whole
               else f"restored {label} on {subject.title} from version {number}")
    changed = subject.apply(
        values,
        metadata={"restored_version": number, "restored_from": target["id"], "fields": sorted(values),
                  "whole_version": whole, "restored_at": now().isoformat()},
        message=message,
    )
    return {
        "restored": sorted(changed),
        "version": number,
        "message": (f"Restored {len(changed)} field{'s' if len(changed) != 1 else ''} from version {number}."
                    if changed else f"Nothing to restore — the record already matches version {number}."),
        "history": history(session, subject.key, subject.row.id, {}, principal=principal),
    }


def _refuse_lost_race(subject: Subject, expected: Any) -> None:
    if not expected:
        return
    current = getattr(subject.row, "updated_at", None)
    try:
        seen = datetime.fromisoformat(str(expected).replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValidationError("expected_updated_at must be a timestamp.") from exc
    if seen.tzinfo is None:
        seen = seen.replace(tzinfo=timezone.utc)
    if current is not None and abs((current - seen).total_seconds()) > 1:
        from src.core.errors import ConflictError

        raise ConflictError(
            "This record changed since you opened its history — reload and try again.",
            details={"expected": seen.isoformat(), "current": current.isoformat()},
        )
