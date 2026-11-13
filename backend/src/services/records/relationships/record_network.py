"""The record network around a set of anchors."""

from __future__ import annotations

from typing import Any

from sqlalchemy import select

from src.core.errors import ValidationError
from src.services.records.explorer import resources
from src.services.records.relationships.anchors import _anchor_records, _rows_per_anchor
from src.services.records.relationships.communities import _cluster
from src.services.records.relationships.linkables import (
    NETWORK_ANCHORS,
    NETWORK_LIMIT,
    NETWORK_PEOPLE,
    Linkable,
    _inbound_relations,
    _key,
    _label_for,
    _linkables,
    _may_read,
    _node,
    _plural,
)


def network(
    session,
    *,
    principal,
    focus: Any = None,
    limit: int = NETWORK_LIMIT,
    anchors: int = NETWORK_ANCHORS,
) -> dict[str, Any]:
    """A real slice of the record graph, clustered into communities (§50).

    The connection map above answers *how do the entity types connect?* This
    answers the question after it — *how do the actual records cluster?* — and
    that is a question about structure, not about any one row: a customer, the
    orders and tickets that name them, the project those tickets are against
    and the people who work them form a community that no single record's page
    can show.

    Built in three steps, each bounded:

    1. **Anchors** — the focus records the most rows point at.
    2. **One hop in** — the newest rows pointing at each anchor, capped *per
       anchor* so one enormous customer cannot spend the whole budget.
    3. **One hop out** — what those rows themselves point at: the project a
       ticket is against, the person who owns an order. This step is what
       produces *bridges*; without it every cluster is an island, and a
       clustering of islands is arithmetic rather than a finding.

    Edges are then derived from the final node set rather than accumulated on
    the way in, so an edge exists exactly when both of its ends are on screen.

    The clustering is :mod:`src.core.graph`'s Louvain, computed here so every
    viewer sees the same partition and the browser only has to draw it.
    """
    linkables = _linkables()
    focus_key = str(focus or "customer")
    resource = resources().get(focus_key)
    if resource is None:
        raise ValidationError(
            "Unknown dataset.",
            details={"focus": focus_key, "available": sorted(resources())},
        )
    principal.require(resource.permission)

    anchors = max(2, min(int(anchors or NETWORK_ANCHORS), 40))
    limit = max(20, min(int(limit or NETWORK_LIMIT), 600))

    focus_linkable = linkables[resource.model.__tablename__]
    inbound = _inbound_relations(resource.model, linkables, principal)

    #: key → (row, linkable). One place, so edges can be derived from it.
    found: dict[str, tuple[Any, Linkable]] = {}

    anchor_rows = _anchor_records(session, resource, inbound, anchors)
    for row in anchor_rows:
        found[_key(focus_linkable, row.id)] = (row, focus_linkable)
    anchor_ids = [row.id for row in anchor_rows]

    hop_one: list[tuple[Any, Linkable]] = []
    for linkable, _column_name, column in inbound:
        for row in _rows_per_anchor(session, linkable, column, anchor_ids):
            key = _key(linkable, row.id)
            if key in found or len(found) >= limit:
                continue
            found[key] = (row, linkable)
            hop_one.append((row, linkable))

    for key, (row, linkable) in _hop_out(
        session, [*hop_one, *((row, focus_linkable) for row in anchor_rows)],
        linkables, principal, limit - len(found),
    ).items():
        found.setdefault(key, (row, linkable))

    nodes = {
        key: _node_for(row, linkable, anchor=linkable is focus_linkable)
        for key, (row, linkable) in found.items()
    }
    return _cluster(nodes, _edges_within(found, linkables), resource, focus_key, principal)


def _hop_out(
    session,
    rows: list[tuple[Any, Linkable]],
    linkables: dict[str, Linkable],
    principal,
    budget: int,
) -> dict[str, tuple[Any, Linkable]]:
    """What the pulled rows themselves point at, fetched one query per table.

    Deliberately includes people. A shared account manager is often the only
    honest reason two customers belong in one cluster, and a graph of records
    without the people on them draws colleagues as strangers.
    """
    wanted: dict[str, set[Any]] = {}
    for row, linkable in rows:
        for fk in linkable.model.__table__.foreign_keys:
            target = linkables.get(fk.column.table.name)
            if target is None or not _may_read(target, principal):
                continue
            value = getattr(row, fk.parent.name, None)
            if value is not None:
                wanted.setdefault(target.table, set()).add(value)

    reached: dict[str, tuple[Any, Linkable]] = {}
    for table, identifiers in sorted(wanted.items()):
        if budget <= 0:
            break
        target = linkables[table]
        cap = NETWORK_PEOPLE if table == "users" else budget
        found = session.scalars(
            select(target.model).where(target.model.id.in_(sorted(identifiers)[:cap]))
        ).unique().all()
        for row in found[:budget]:
            reached[_key(target, row.id)] = (row, target)
            budget -= 1
    return reached


def _edges_within(
    found: dict[str, tuple[Any, Linkable]], linkables: dict[str, Linkable]
) -> list[dict[str, Any]]:
    """Every foreign key whose *both* ends are on screen.

    Derived rather than accumulated, so the picture cannot contain a line to
    something that was cut for the node budget.
    """
    edges: list[dict[str, Any]] = []
    seen: set[tuple[str, str, str]] = set()
    for key, (row, linkable) in found.items():
        for fk in sorted(linkable.model.__table__.foreign_keys, key=lambda item: item.parent.name):
            target = linkables.get(fk.column.table.name)
            if target is None:
                continue
            value = getattr(row, fk.parent.name, None)
            if value is None:
                continue
            other = _key(target, value)
            if other == key or other not in found:
                continue
            signature = (key, other, fk.parent.name)
            if signature in seen:
                continue
            seen.add(signature)
            edges.append({
                "source": key,
                "target": other,
                "relation": fk.parent.name,
                "label": _label_for(fk.parent.name),
            })
    return edges


def _node_for(row, linkable: Linkable, *, anchor: bool = False) -> dict[str, Any]:
    node = _node(row, linkable)
    node["key"] = _key(linkable, row.id)
    node["entity_label"] = _plural(linkable)
    node["anchor"] = anchor
    node["status"] = str(getattr(row, "status", "") or "")
    return node
