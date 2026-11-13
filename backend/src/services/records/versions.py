"""Record version history with point-in-time restore (§17).

"The audit diff exists; add point-in-time restore." So the versions *are* the
audit trail — no second ledger. Every write the product makes to a record is
already an audit row carrying the fields that moved, both sides
(`changes = {field: {from, to}}`). Reading those rows newest-first and
stepping the record's *current* state backwards through each `from` yields
the full state after every write: version N is now, version N-1 is now with
the last change undone, and so on back to the create.

Three consequences worth stating:

* **A version is a full state, not a diff.** Any two can be compared side by
  side, and "view as of a date" is the last version at or before it.
* **A record older than its audit trail still has a beginning.** When the
  oldest row is not the create (seeded data, a trail that was pruned), the
  state before the oldest change is shown as "earliest recorded", dated to the
  record's creation — honest about what is known.
* **Restore is a write like any other, and audited as one.** Restoring a whole
  version or chosen fields goes through the same coercion an edit does —
  vocabulary, bounds, and foreign keys that must still exist — under the edit
  permission *and* `records.restore`, refuses a lost race, and leaves an audit
  row with action `RESTORE` naming the version it came from. That row is in
  turn a version, so a restore can itself be undone.

Works for every explorer dataset with editable fields, and for contracts
(§13), whose writes leave the same shape of audit row.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Callable

from sqlalchemy import select

from src.core import audit
from src.core.clock import now
from src.core.errors import NotFoundError, ValidationError

RESTORE_PERMISSION = "records.restore"
#: The audit rows read for one record. Far more than any record in the demo
#: has; a cap rather than an unbounded read.
MAX_ROWS = 500


@dataclass
class Subject:
    """What version history needs to know about one kind of record."""

    key: str
    label: str
    fields: dict[str, dict[str, Any]]
    row: Any
    title: str
    current: dict[str, Any]
    edit_permission: str
    apply: Callable[..., set[str]]


def _subject(session, resource_type: str, record_id: Any, *, principal) -> Subject:
    if resource_type == "contract":
        from src.services.records import contracts

        principal.require(contracts.VIEW)
        row = contracts.load(session, record_id)

        def apply_contract(values: dict[str, Any], *, metadata, message) -> set[str]:
            coerced = contracts.coerce(session, values, creating=False)
            return contracts.apply(session, row, coerced, principal=principal, action="RESTORE",
                                   message=message, metadata=metadata)

        kinds = {
            "text": "text", "longtext": "text", "customer": "uuid", "user": "uuid", "money": "number",
            "currency": "enum", "date": "datetime", "int": "number", "billing": "enum", "bool": "bool",
            "stage": "enum", "percent": "number",
        }
        refs = {"customer_id": "customer", "owner_id": "user"}
        return Subject(
            key="contract", label="Contract",
            fields={name: {"name": name, "label": contracts.LABELS[name], "kind": kinds[kind],
                           "references": refs.get(name, "")}
                    for name, kind in contracts.FIELDS.items()},
            row=row, title=f"{row.reference} — {row.title}", current=contracts.state(row),
            edit_permission=contracts.MANAGE, apply=apply_contract,
        )

    from src.services.records import writes as writes
    from src.services.records.explorer import references_of, resource_for

    resource = resource_for(resource_type, principal=principal)
    if not resource.editable:
        raise ValidationError(f"{resource.label} have no editable fields to version.",
                              details={"resource_type": resource.key})
    row = writes._load(session, resource, record_id)

    def apply_record(values: dict[str, Any], *, metadata, message) -> set[str]:
        try:
            coerced, problems = writes.coerce(session, resource, values, creating=False)
        except NotFoundError as missing:
            # A reference the old version held has since been deleted.
            raise ValidationError(f"That version cannot be restored: {missing.message}",
                                  details=dict(missing.details)) from missing
        if problems:
            first = problems[0]
            raise ValidationError(
                f"That version cannot be restored: {first['message']}",
                details={"problems": problems, **dict(first.get("details") or {})},
            )
        before = writes._state(resource, row, only=coerced)
        for name, value in coerced.items():
            setattr(row, name, value)
        after = writes._state(resource, row, only=coerced)
        changed = {name for name in coerced if before.get(name) != after.get(name)}
        if not changed:
            return changed
        session.flush()
        writes._after_write(session, resource, row, changed)
        audit.record(
            session, action="RESTORE", resource_type=resource.key, resource_id=row.id,
            resource_label=resource.label_for(row), principal=principal,
            before={k: before[k] for k in changed}, after={k: after[k] for k in changed},
            message=message, metadata=metadata,
        )
        session.flush()
        return changed

    fields = {}
    for spec in resource.editable:
        field = resource.fields.by_name[spec.name]
        fields[spec.name] = {"name": spec.name, "label": field.title, "kind": field.kind,
                             "references": references_of(field) if field.kind == "uuid" else ""}
    return Subject(
        key=resource.key, label=resource.label.rstrip("s"), fields=fields, row=row,
        title=resource.label_for(row), current=writes._state(resource, row),
        edit_permission=writes.UPDATE_PERMISSION, apply=apply_record,
    )


def _audit_rows(session, subject: Subject) -> list[Any]:
    from src.models.platform import AuditLog

    rows = session.scalars(
        select(AuditLog)
        .where(AuditLog.resource_type == subject.key, AuditLog.resource_id == str(subject.row.id),
               AuditLog.result == "SUCCESS")
        .order_by(AuditLog.occurred_at.desc(), AuditLog.created_at.desc())
        .limit(MAX_ROWS)
    ).all()
    return list(reversed(rows))


def _touched(row, fields: dict[str, Any]) -> dict[str, Any]:
    """The `from` value of every versioned field this audit row changed."""
    changes = row.changes or {}
    out = {name: change.get("from") for name, change in changes.items()
           if name in fields and isinstance(change, dict)}
    if not out and row.state_before:
        out = {name: value for name, value in row.state_before.items() if name in fields}
    if not out and row.state_after and row.action != "CREATE":
        out = {name: None for name in row.state_after if name in fields}
    return out


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
