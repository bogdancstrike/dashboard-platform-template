"""One record's outbound and inbound links."""

from __future__ import annotations

from typing import Any

from sqlalchemy import func, select

from src.core.errors import ValidationError
from src.core.pagination import parse_uuid
from src.core.repository import get_or_404
from src.services.records.explorer import resources
from src.services.records.relationships.linkables import (
    MAX_SAMPLE,
    SAMPLE,
    _label_for,
    _linkables,
    _may_read,
    _node,
    _plural,
)


def graph(session, resource_type: Any, record_id: Any, *, principal, sample: int = SAMPLE) -> dict[str, Any]:
    """One record, everything it points at, and everything pointing at it."""
    if sample < 1 or sample > MAX_SAMPLE:
        raise ValidationError(f"sample must be between 1 and {MAX_SAMPLE}")

    resource = resources().get(str(resource_type or ""))
    if resource is None:
        raise ValidationError(
            "Unknown dataset.",
            details={"resource_type": str(resource_type or ""), "available": sorted(resources())},
        )
    principal.require(resource.permission)

    identifier = parse_uuid(record_id, field="id")
    record = get_or_404(
        session, resource.model, identifier, "That record does not exist.", live=True
    )

    linkables = _linkables()
    root = _node(record, linkables[resource.model.__tablename__])
    root["resource_type"] = resource.key

    groups = [
        *_outbound(session, record, resource.model, linkables, principal),
        *_inbound(session, record, resource.model, linkables, principal, sample),
    ]
    return {
        "root": root,
        "groups": groups,
        "total": sum(group["total"] for group in groups),
    }


def _outbound(session, record, model, linkables, principal) -> list[dict[str, Any]]:
    """What this record points at — one row per foreign key that is set."""
    groups: list[dict[str, Any]] = []
    for fk in sorted(model.__table__.foreign_keys, key=lambda item: item.parent.name):
        target = linkables.get(fk.column.table.name)
        if target is None or not _may_read(target, principal):
            continue
        value = getattr(record, fk.parent.name, None)
        if value is None:
            continue
        # A self-reference is a real relationship — a task's parent task — and
        # is worth showing under its own name rather than hidden as a loop.
        row = session.get(target.model, value)
        if row is None:
            continue
        groups.append({
            "direction": "outbound",
            "relation": fk.parent.name,
            "label": _label_for(fk.parent.name),
            "target": target.resource_key or target.table,
            "total": 1,
            "has_more": False,
            "items": [_node(row, target)],
        })
    return groups


def _inbound(session, record, model, linkables, principal, sample: int) -> list[dict[str, Any]]:
    """What points at this record — counted, then sampled newest first."""
    groups: list[dict[str, Any]] = []
    for linkable in linkables.values():
        if not _may_read(linkable, principal):
            continue
        for fk in sorted(linkable.model.__table__.foreign_keys, key=lambda item: item.parent.name):
            if fk.column.table.name != model.__table__.name:
                continue
            column = getattr(linkable.model, fk.parent.name)
            statement = select(linkable.model).where(column == record.id)
            deleted = getattr(linkable.model, "deleted_at", None)
            if deleted is not None:
                statement = statement.where(deleted.is_(None))

            total = session.scalar(
                select(func.count()).select_from(statement.subquery())
            ) or 0
            if total == 0:
                continue

            ordering = getattr(linkable.model, "updated_at", None) or linkable.model.id
            rows = session.scalars(
                statement.order_by(ordering.desc()).limit(sample)
            ).unique().all()
            groups.append({
                "direction": "inbound",
                "relation": f"{linkable.table}.{fk.parent.name}",
                # Read from the other side: "Tickets · as Customer".
                "label": f"{_plural(linkable)} · as {_label_for(fk.parent.name).lower()}",
                "target": linkable.resource_key or linkable.table,
                "total": total,
                "has_more": total > len(rows),
                "items": [_node(row, linkable) for row in rows],
            })
    return groups
