"""Choosing the records a network is built around."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from sqlalchemy import func, select

from src.services.records.relationships.linkables import NETWORK_PER_RELATION


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
