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


# ── the map, with no record chosen ───────────────────────────────────────

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


# ── the record network, clustered ────────────────────────────────────────

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


def _anchor_records(session, resource, inbound, anchors: int) -> list[Any]:
    """The focus records the most rows point at, across every relation.

    One GROUP BY per relation and a merge in Python: asking "how connected is
    this?" of every customer one at a time is a query per row for a picture
    with fourteen of them on it.
    """
    scored: dict[Any, int] = {}
    for linkable, _name, column in inbound:
        statement = (
            select(column.label("anchor"), func.count().label("total"))
            .where(column.isnot(None))
            .group_by(column)
            .order_by(func.count().desc())
            .limit(anchors * 4)
        )
        deleted = getattr(linkable.model, "deleted_at", None)
        if deleted is not None:
            statement = statement.where(deleted.is_(None))
        for anchor_id, total in session.execute(statement).all():
            scored[anchor_id] = scored.get(anchor_id, 0) + int(total)

    top = sorted(scored.items(), key=lambda item: (-item[1], str(item[0])))[:anchors]
    if not top:
        return _anchors_by_shared_parent(session, resource, anchors)
    found = session.scalars(
        select(resource.model).where(resource.model.id.in_([anchor for anchor, _ in top]))
    ).unique().all()
    order = {anchor: index for index, (anchor, _) in enumerate(top)}
    return sorted(found, key=lambda row: order.get(row.id, len(order)))


def _anchors_by_shared_parent(session, resource, anchors: int) -> list[Any]:
    """Anchors for an entity nothing points at — devices, orders, tickets.

    There is no "most pointed at" record to build around, and the newest rows
    are the wrong answer: fifty tickets picked by recency share nothing, and
    the picture comes out as fifty separate islands, which is true and useless.

    So cluster them the way they actually cluster — around the parent they
    share. The entity's fullest foreign key is found, its busiest values taken,
    and rows drawn evenly from each. People are skipped when choosing that key:
    a fleet grouped by *who is on shift* is a rota, not a structure.
    """
    columns = [
        (fk.parent.name, getattr(resource.model, fk.parent.name, None), fk.column.table.name)
        for fk in sorted(resource.model.__table__.foreign_keys, key=lambda item: item.parent.name)
    ]
    candidates = [item for item in columns if item[1] is not None and item[2] != "users"]
    if not candidates:
        candidates = [item for item in columns if item[1] is not None]

    deleted = getattr(resource.model, "deleted_at", None)
    best: tuple[int, Any, list[Any]] | None = None
    for name, column, _table in candidates:
        statement = (
            select(column.label("parent"), func.count().label("total"))
            .where(column.isnot(None))
            .group_by(column)
            .order_by(func.count().desc())
            .limit(anchors)
        )
        if deleted is not None:
            statement = statement.where(deleted.is_(None))
        rows = session.execute(statement).all()
        covered = sum(int(total) for _parent, total in rows)
        if rows and (best is None or covered > best[0]):
            best = (covered, column, [parent for parent, _total in rows])

    if best is None:
        ordering = getattr(resource.model, "updated_at", None) or resource.model.id
        statement = select(resource.model).order_by(ordering.desc()).limit(anchors * 4)
        if deleted is not None:
            statement = statement.where(deleted.is_(None))
        return list(session.scalars(statement).unique().all())

    _covered, column, parents = best
    return _rows_per_anchor(session, _SelfLinkable(resource.model), column, parents, per=6)


@dataclass(frozen=True, slots=True)
class _SelfLinkable:
    """Just enough of a :class:`Linkable` for `_rows_per_anchor` to work."""

    model: type


def _rows_per_anchor(session, linkable, column, anchor_ids, *, per: int = NETWORK_PER_RELATION) -> list[Any]:
    """The newest rows pointing at each anchor, capped *per anchor*.

    A plain `LIMIT` would spend the whole budget on the busiest customer and
    draw the rest as bare circles. `row_number()` partitioned by the anchor
    gives every cluster the same number of members, which is what makes the
    picture comparable across them.
    """
    if not anchor_ids:
        return []
    ordering = getattr(linkable.model, "updated_at", None) or linkable.model.id
    ranked = (
        select(
            linkable.model.id.label("id"),
            func.row_number()
            .over(partition_by=column, order_by=ordering.desc())
            .label("rank"),
        )
        .where(column.in_(anchor_ids))
    )
    deleted = getattr(linkable.model, "deleted_at", None)
    if deleted is not None:
        ranked = ranked.where(deleted.is_(None))
    ranked = ranked.subquery()

    wanted = session.scalars(select(ranked.c.id).where(ranked.c.rank <= per)).all()
    if not wanted:
        return []
    return list(
        session.scalars(select(linkable.model).where(linkable.model.id.in_(wanted)))
        .unique()
        .all()
    )


def _key(linkable: Linkable, identifier: Any) -> str:
    """`customer:9f2c…` — entity-scoped, so two tables cannot collide."""
    return f"{linkable.resource_key or linkable.table}:{identifier}"


def _node_for(row, linkable: Linkable, *, anchor: bool = False) -> dict[str, Any]:
    node = _node(row, linkable)
    node["key"] = _key(linkable, row.id)
    node["entity_label"] = _plural(linkable)
    node["anchor"] = anchor
    node["status"] = str(getattr(row, "status", "") or "")
    return node


def _cluster(
    nodes: dict[str, dict[str, Any]],
    edges: list[dict[str, Any]],
    resource,
    focus_key: str,
    principal,
) -> dict[str, Any]:
    """Detect communities, size the nodes, and describe each cluster."""
    from src.core import graph as graph_math

    pairs = [(edge["source"], edge["target"]) for edge in edges]
    keys = sorted(nodes)
    grouping = graph_math.communities(keys, pairs)
    degree = graph_math.degrees(keys, pairs)
    crossing = {
        (source, target) for source, target in graph_math.bridges(pairs, grouping)
    }

    for key, node in nodes.items():
        node["community"] = grouping.get(key, key)
        node["degree"] = degree.get(key, 0)

    for edge in edges:
        pair = (edge["source"], edge["target"])
        edge["bridge"] = pair in crossing or (pair[1], pair[0]) in crossing

    return {
        "focus": {"key": focus_key, "label": resource.label},
        "available": [
            {"key": item.key, "label": item.label}
            for item in resources().values()
            if principal.can(item.permission)
        ],
        "nodes": [nodes[key] for key in keys],
        "edges": edges,
        "communities": _describe_communities(nodes, edges, grouping),
        "stats": {
            "nodes": len(nodes),
            "edges": len(edges),
            "communities": len(set(grouping.values())),
            # Newman's Q: above ~0.3 the clustering is structure rather than
            # noise. Shipped so the page can say how much to trust the picture.
            "modularity": graph_math.modularity(keys, pairs, grouping),
            "bridges": len(crossing),
        },
    }


def _describe_communities(
    nodes: dict[str, dict[str, Any]],
    edges: list[dict[str, Any]],
    grouping: dict[str, str],
) -> list[dict[str, Any]]:
    """One row per cluster: what is in it, who leads it, what it touches.

    A coloured blob is not a finding. "Nine records around Northwind Trading —
    six orders, two tickets, one project — joined to the rest through Ana
    Analyst" is, and it is readable without looking at the picture at all,
    which is what makes the analysis accessible (§55).
    """
    members: dict[str, list[dict[str, Any]]] = {}
    for key, node in nodes.items():
        members.setdefault(grouping.get(key, key), []).append(node)

    summaries = []
    for community, group in members.items():
        ranked = sorted(group, key=lambda node: (-node["degree"], node["label"]))
        mix: dict[str, int] = {}
        for node in group:
            mix[node["entity_label"]] = mix.get(node["entity_label"], 0) + 1
        inside = sum(
            1
            for edge in edges
            if grouping.get(edge["source"]) == community
            and grouping.get(edge["target"]) == community
        )
        summaries.append({
            "id": community,
            # Named after its most connected member, which is what a person
            # would call it: "the Northwind cluster".
            "label": ranked[0]["label"] if ranked else community,
            "entity": ranked[0]["entity"] if ranked else "",
            "size": len(group),
            "mix": [
                {"label": label, "count": count}
                for label, count in sorted(mix.items(), key=lambda item: -item[1])
            ],
            "members": [
                {
                    "key": node["key"],
                    "id": node["id"],
                    "label": node["label"],
                    "entity": node["entity"],
                    "entity_label": node["entity_label"],
                    "degree": node["degree"],
                    "explorable": node["explorable"],
                }
                for node in ranked[:6]
            ],
            "internal_links": inside,
            "external_links": sum(
                1
                for edge in edges
                if edge["bridge"]
                and community in (grouping.get(edge["source"]), grouping.get(edge["target"]))
            ),
        })

    summaries.sort(key=lambda item: (-item["size"], item["label"]))
    return summaries
