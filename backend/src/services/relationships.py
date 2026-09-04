"""How records connect (§44, §50).

The explorer answers questions about one dataset at a time. This answers the
question that follows the answer: *this ticket — who raised it, which customer,
which project, and what else is attached to that project?*

The connections are **derived from the schema, not declared here.** Every link
is a foreign key that already exists, so the map cannot fall behind the model:
adding a column with a `ForeignKey` makes the relationship appear, and removing
one makes it disappear. A hand-written adjacency list is a second description
of the database that is wrong the first time anybody migrates.

Two directions, because they answer different questions:

* **outbound** — what this record points at. One row each: a ticket has one
  customer.
* **inbound** — what points at this record. Many rows, so they are counted and
  sampled: a customer has three hundred orders, and the useful answer is "300,
  here are the newest ten".
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.inspection import inspect as sa_inspect

from src.core.clock import iso
from src.core.errors import NotFoundError, ValidationError
from src.core.pagination import parse_uuid
from src.services.explorer import resources

#: Rows shown per inbound relation before "and N more".
SAMPLE = 8
MAX_SAMPLE = 50


@dataclass(frozen=True, slots=True)
class Linkable:
    """An entity a relationship may point at, and how to name one."""

    table: str
    model: type
    #: First column that exists is used as the row's human label.
    label_columns: tuple[str, ...]
    #: The explorer dataset this maps to, when it has one. A person is a
    #: perfectly good node and has no dataset to open.
    resource_key: str | None = None

    @property
    def label_column(self):
        for name in self.label_columns:
            column = getattr(self.model, name, None)
            if column is not None:
                return column
        return self.model.id


def _linkables() -> dict[str, Linkable]:
    """Everything a foreign key may resolve to, keyed by table name."""
    from src.models.identity import Department, Organization, Region, Team, User

    linkables = {
        resource.model.__tablename__: Linkable(
            table=resource.model.__tablename__,
            model=resource.model,
            label_columns=resource.default_columns[:2],
            resource_key=resource.key,
        )
        for resource in resources().values()
    }
    for model, columns in (
        (User, ("full_name", "email")),
        (Organization, ("name",)),
        (Department, ("name", "code")),
        (Region, ("name", "code")),
        (Team, ("name",)),
    ):
        linkables[model.__tablename__] = Linkable(
            table=model.__tablename__, model=model, label_columns=columns
        )
    return linkables


def _label_for(column_name: str) -> str:
    """`account_manager_id` → `Account manager`. The relationship's own name."""
    trimmed = column_name[:-3] if column_name.endswith("_id") else column_name
    spaced = trimmed.replace("_", " ")
    return spaced[:1].upper() + spaced[1:]


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
    record = session.get(resource.model, identifier)
    if record is None or getattr(record, "deleted_at", None) is not None:
        raise NotFoundError("That record does not exist.")

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


def _may_read(linkable: Linkable, principal) -> bool:
    """A dataset behind a permission is not traversed by somebody without it.

    Entities with no explorer dataset — people, regions, departments — are
    reference data every signed-in role already sees in a picker.
    """
    if linkable.resource_key is None:
        return True
    return principal.can(resources()[linkable.resource_key].permission)


def _plural(linkable: Linkable) -> str:
    if linkable.resource_key:
        return resources()[linkable.resource_key].label
    return linkable.table.replace("_", " ").title()


def _node(row, linkable: Linkable) -> dict[str, Any]:
    values = [
        str(getattr(row, name)) for name in linkable.label_columns if getattr(row, name, None)
    ]
    return {
        "id": str(row.id),
        "label": values[0] if values else str(row.id),
        "summary": values[1] if len(values) > 1 else "",
        "entity": linkable.resource_key or linkable.table,
        # Only an explorer dataset can be opened; the rest are context.
        "explorable": linkable.resource_key is not None,
        "updated_at": iso(getattr(row, "updated_at", None)),
    }


def entity_of(model) -> str:
    """The public name of a model's table, for tests and for logging."""
    return sa_inspect(model).local_table.name
