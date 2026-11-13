"""The map of relations with no record chosen, and its hubs."""

from __future__ import annotations

from typing import Any

from sqlalchemy import func, select

from src.services.records.relationships.linkables import (
    Linkable,
    _label_for,
    _linkables,
    _may_read,
    _node,
    _plural,
)

#: How many of the strongest relations to profile for hub records. Each costs
#: one GROUP BY, so this is a budget rather than a preference.
PROFILED_EDGES = 6


#: Hub records per profiled relation.
HUBS_PER_EDGE = 4


def overview(session, *, principal) -> dict[str, Any]:
    """The whole connection map, before anybody has picked a record.

    A relationship explorer that opens on an empty search box asks the reader
    to already know what they are looking for. This answers the question they
    actually arrive with — *how does any of this connect?* — with three things
    that are only meaningful in aggregate:

    * **The graph of entity types**, edges weighted by how many rows actually
      carry each foreign key. Derived from the schema like everything else
      here, so it cannot describe a link the database does not have.
    * **Coverage**, because "600 tickets, 583 of which name a customer" is a
      different fact from "tickets have customers", and the 17 are usually the
      interesting ones.
    * **Hubs** — the records the most things point at. They are where an
      exploration is worth starting, and they cannot be found by looking at one
      record at a time.
    """
    linkables = _linkables()
    readable = {
        table: linkable for table, linkable in linkables.items() if _may_read(linkable, principal)
    }

    nodes = []
    for table, linkable in readable.items():
        nodes.append({
            "key": linkable.resource_key or table,
            "table": table,
            "label": _plural(linkable),
            "count": _live_count(session, linkable.model),
            "explorable": linkable.resource_key is not None,
        })

    edges = []
    for table, linkable in readable.items():
        total = next((node["count"] for node in nodes if node["table"] == table), 0)
        for fk in sorted(linkable.model.__table__.foreign_keys, key=lambda item: item.parent.name):
            target = readable.get(fk.column.table.name)
            if target is None:
                continue
            column = getattr(linkable.model, fk.parent.name, None)
            if column is None:
                continue
            linked = _live_count(session, linkable.model, column.isnot(None))
            if linked == 0:
                continue
            edges.append({
                "relation": fk.parent.name,
                "label": _label_for(fk.parent.name),
                "source": linkable.resource_key or table,
                "source_label": _plural(linkable),
                "target": target.resource_key or target.table,
                "target_label": _plural(target),
                "count": linked,
                # Of the rows that could carry this link, how many do. The gap
                # is the finding: an unassigned ticket is a real ticket.
                "coverage": round(100 * linked / total, 1) if total else 0.0,
                "source_total": total,
            })

    edges.sort(key=lambda edge: edge["count"], reverse=True)
    return {
        "nodes": sorted(nodes, key=lambda node: node["count"], reverse=True),
        "edges": edges,
        "hubs": _hubs(session, edges, readable),
        "totals": {
            "records": sum(node["count"] for node in nodes),
            "entities": len(nodes),
            "relations": len(edges),
            "links": sum(edge["count"] for edge in edges),
        },
    }


def _live_count(session, model, *conditions) -> int:
    statement = select(func.count()).select_from(model)
    deleted = getattr(model, "deleted_at", None)
    if deleted is not None:
        statement = statement.where(deleted.is_(None))
    for condition in conditions:
        statement = statement.where(condition)
    return int(session.scalar(statement) or 0)


def _hubs(session, edges: list[dict[str, Any]], readable: dict[str, Linkable]) -> list[dict[str, Any]]:
    """The records the most rows point at, along the strongest relations.

    One GROUP BY per profiled relation rather than a count per record: asking
    "how connected is this customer?" of three hundred customers one at a time
    is three hundred round trips for a panel nobody would wait for.
    """
    by_table = {linkable.resource_key or table: linkable for table, linkable in readable.items()}
    hubs: list[dict[str, Any]] = []

    for edge in edges[:PROFILED_EDGES]:
        source = by_table.get(edge["source"])
        target = by_table.get(edge["target"])
        if source is None or target is None:
            continue
        column = getattr(source.model, edge["relation"], None)
        if column is None:
            continue

        counted = (
            select(column.label("target_id"), func.count().label("total"))
            .select_from(source.model)
            .where(column.isnot(None))
            .group_by(column)
            .order_by(func.count().desc())
            .limit(HUBS_PER_EDGE)
        )
        deleted = getattr(source.model, "deleted_at", None)
        if deleted is not None:
            counted = counted.where(deleted.is_(None))

        rows = session.execute(counted).all()
        if not rows:
            continue

        found = {
            row.id: row
            for row in session.scalars(
                select(target.model).where(target.model.id.in_([r.target_id for r in rows]))
            ).unique().all()
        }
        for target_id, total in rows:
            record = found.get(target_id)
            if record is None:
                continue
            node = _node(record, target)
            hubs.append({
                **node,
                "resource_type": target.resource_key or target.table,
                "connections": int(total),
                "via": edge["label"],
                "via_label": f"{edge['source_label']} · as {edge['label'].lower()}",
            })

    hubs.sort(key=lambda hub: hub["connections"], reverse=True)
    return hubs
