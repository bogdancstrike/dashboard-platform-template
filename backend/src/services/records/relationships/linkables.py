"""The datasets that link to each other, and how a node is labelled."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from src.core.clock import iso
from src.services.records.explorer import resources

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


#: Nodes past this stop being a picture and start being a hairball. The cap is
#: on the *answer*, not on a page of it: half a community is a wrong community.
NETWORK_LIMIT = 320


#: How many focus records to build the network around.
NETWORK_ANCHORS = 14


#: Rows pulled per anchor per relation. Small on purpose — the shape of a
#: cluster is visible in five members and unreadable in fifty.
NETWORK_PER_RELATION = 5


#: People are the connective tissue between clusters, and there are 150 of
#: them; only the ones that actually appear on a pulled row are included.
NETWORK_PEOPLE = 60


def _inbound_relations(model, linkables, principal) -> list[tuple[Linkable, str, Any]]:
    """Every readable dataset that carries a foreign key into `model`."""
    found = []
    for linkable in linkables.values():
        if linkable.resource_key is None or not _may_read(linkable, principal):
            continue
        if linkable.model is model:
            continue
        for fk in sorted(linkable.model.__table__.foreign_keys, key=lambda item: item.parent.name):
            if fk.column.table.name != model.__tablename__:
                continue
            column = getattr(linkable.model, fk.parent.name, None)
            if column is not None:
                found.append((linkable, fk.parent.name, column))
    return found


def _key(linkable: Linkable, identifier: Any) -> str:
    """`customer:9f2c…` — entity-scoped, so two tables cannot collide."""
    return f"{linkable.resource_key or linkable.table}:{identifier}"
