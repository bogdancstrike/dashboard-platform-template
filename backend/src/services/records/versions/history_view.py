"""Rebuilding versions from the audit trail: history and comparison."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select

from src.core.clock import now
from src.core.errors import NotFoundError, ValidationError
from src.services.records.versions.subjects import (
    RESTORE_PERMISSION,
    Subject,
    _audit_rows,
    _subject,
    _touched,
)


def build(session, subject: Subject) -> list[dict[str, Any]]:
    """Every version, oldest first, each a full state of the versioned fields."""
    rows = [row for row in _audit_rows(session, subject)
            if row.action == "CREATE" or _touched(row, subject.fields)]
    state = {name: subject.current.get(name) for name in subject.fields}
    versions: list[dict[str, Any]] = []
    reached_create = False
    for row in reversed(rows):
        changed = sorted(_touched(row, subject.fields)) if row.action != "CREATE" else sorted(
            name for name in (row.state_after or {}) if name in subject.fields)
        versions.append({
            "id": str(row.id),
            "at": row.occurred_at.isoformat(),
            "action": row.action,
            "actor": row.actor_label or "System",
            "actor_id": str(row.actor_id) if row.actor_id else None,
            "message": row.message or "",
            "changed": changed,
            "restored_from": (row.metadata_json or {}).get("restored_version") if row.action == "RESTORE" else None,
            "state": dict(state),
        })
        if row.action == "CREATE":
            if row.state_after:
                # The create's own record of what it wrote is the truth for
                # anything no later row mentions.
                for name, value in row.state_after.items():
                    if name in subject.fields and name not in _later_fields(versions[:-1]):
                        versions[-1]["state"][name] = value
            reached_create = True
            break
        for name, value in _touched(row, subject.fields).items():
            state[name] = value
    if not reached_create:
        created = getattr(subject.row, "created_at", None)
        versions.append({
            "id": "baseline",
            "at": (created or (rows[0].occurred_at if rows else now())).isoformat(),
            "action": "BASELINE",
            "actor": "Earliest recorded",
            "actor_id": None,
            "message": "The state before the oldest change on record",
            "changed": [],
            "restored_from": None,
            "state": dict(state),
        })
    versions.reverse()
    for number, version in enumerate(versions, start=1):
        version["number"] = number
    return versions


def _later_fields(versions: list[dict[str, Any]]) -> set[str]:
    return {name for version in versions for name in version["changed"]}


def _resolve(session, subject: Subject, versions: list[dict[str, Any]]) -> dict[str, dict[str, str]]:
    """Display names for every id a reference field holds in any version."""
    from uuid import UUID

    from src.models.identity import User
    from src.services.records.explorer import resource_for

    wanted: dict[str, set[UUID]] = {}
    for name, spec in subject.fields.items():
        if not spec["references"]:
            continue
        for version in versions:
            value = version["state"].get(name)
            try:
                wanted.setdefault(spec["references"], set()).add(UUID(str(value)))
            except (TypeError, ValueError):
                continue
    names: dict[str, dict[str, str]] = {}
    for target, ids in wanted.items():
        if not ids:
            continue
        if target == "user":
            rows = session.scalars(select(User).where(User.id.in_(ids))).all()
            names[target] = {str(r.id): r.full_name for r in rows}
            continue
        try:
            resource = resource_for(target)
        except ValidationError:  # pragma: no cover - a reference to an undeclared table
            continue
        rows = session.scalars(select(resource.model).where(resource.model.id.in_(ids))).all()
        names[target] = {str(r.id): resource.label_for(r) for r in rows}
    return names


def history(session, resource_type: str, record_id: Any, args, *, principal) -> dict[str, Any]:
    """Every version of one record, or the one in force at `?at=`."""
    subject = _subject(session, str(resource_type), record_id, principal=principal)
    versions = build(session, subject)
    at = args.get("at") if args is not None else None
    as_of = None
    if at:
        moment = _moment(at)
        candidates = [v for v in versions if datetime.fromisoformat(v["at"]) <= moment]
        if not candidates:
            raise NotFoundError("There is no version of this record that early.",
                                details={"at": str(at), "earliest": versions[0]["at"] if versions else None})
        as_of = candidates[-1]["number"]
    return {
        "resource_type": subject.key,
        "record_id": str(subject.row.id),
        "title": subject.title,
        "fields": list(subject.fields.values()),
        "versions": versions,
        "current": len(versions),
        "as_of": as_of,
        "references": _resolve(session, subject, versions),
        "can_restore": principal.can(subject.edit_permission, RESTORE_PERMISSION),
        "updated_at": subject.row.updated_at.isoformat() if getattr(subject.row, "updated_at", None) else None,
    }


def compare(session, resource_type: str, record_id: Any, args, *, principal) -> dict[str, Any]:
    """Two versions side by side, field by field, with the differences marked."""
    subject = _subject(session, str(resource_type), record_id, principal=principal)
    versions = build(session, subject)
    a = _number(args.get("a"), versions, "a", default=max(1, len(versions) - 1))
    b = _number(args.get("b"), versions, "b", default=len(versions))
    left, right = versions[a - 1], versions[b - 1]
    rows = []
    for name, spec in subject.fields.items():
        before, after = left["state"].get(name), right["state"].get(name)
        rows.append({**spec, "a": before, "b": after, "differs": before != after})
    return {
        "a": {k: v for k, v in left.items() if k != "state"},
        "b": {k: v for k, v in right.items() if k != "state"},
        "fields": rows,
        "differences": sum(1 for r in rows if r["differs"]),
        "references": _resolve(session, subject, [left, right]),
    }


def _number(raw: Any, versions: list[dict[str, Any]], name: str, *, default: int | None) -> int:
    if raw in (None, ""):
        if default is None:
            raise ValidationError(f"{name} is required.", details={"field": name})
        return max(1, min(default, len(versions)))
    try:
        number = int(str(raw))
    except ValueError as exc:
        raise ValidationError(f"{name} must be a version number.", details={"field": name}) from exc
    if not 1 <= number <= len(versions):
        raise NotFoundError(f"There is no version {number}.",
                            details={"field": name, "versions": len(versions)})
    return number


def _moment(raw: Any) -> datetime:
    text = str(raw).strip().replace("Z", "+00:00")
    # A bare date means the end of that day: "as of the 3rd" includes the 3rd.
    if len(text) == 10:
        text = f"{text}T23:59:59.999999"
    try:
        moment = datetime.fromisoformat(text)
    except ValueError as exc:
        raise ValidationError("at must be a date or timestamp.", details={"field": "at"}) from exc
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return moment
