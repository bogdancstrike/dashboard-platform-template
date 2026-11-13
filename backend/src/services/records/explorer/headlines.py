"""Headline numbers, breakdowns and trends for a dataset (§44, §71)."""

from __future__ import annotations

from typing import Any

from sqlalchemy import Numeric, func, select
from sqlalchemy import cast as sql_cast

from src.core import cache
from src.core.errors import ValidationError
from src.core.query import apply_filters, count_of
from src.core.rules import compile_tree
from src.services.records.explorer.model import Metric, Resource
from src.services.records.explorer.querying import _base_statement, _query_args
from src.services.records.explorer.registry import resource_for
from src.services.records.explorer.trends import _column_of, _trend

#: Values per breakdown before the tail is dropped. A pie with forty slices is
#: a colour wheel.
BREAKDOWN_LIMIT = 8


def insights(session, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    """What a dataset says about the rows the reader is currently looking at.

    Deliberately the *same* filters as the list beside it. A summary computed
    over the whole table while the table below shows a filtered slice is two
    answers to one question, and the reader has no way to tell which is which —
    so this takes the identical payload `run` takes and applies it identically.

    Everything is aggregated in PostgreSQL. Summing a page of twenty-five rows
    in the browser gives "revenue: 41 000" for a dataset holding four million,
    which is not a smaller version of the right answer but a wrong one.

    What is returned is decided by the `Insight` declared on the resource, so
    adding a headline number to a dataset is a declaration rather than an
    endpoint and a page.
    """
    if not isinstance(payload, dict):
        raise ValidationError("The query must be a JSON object.")
    resource = resource_for(payload.get("resource_type"), principal=principal)

    # Cached on the question *and* on the dataset's generation, because this is
    # a `COUNT`, a `SUM`, up to eight `GROUP BY`s and a thirty-bucket trend
    # over the whole filtered set — every one of which the list beside it asks
    # again on each page, sort and filter change. Invalidated by the writes
    # that make it stale: a reader who has just closed a ticket must not be
    # shown their own change missing from the number above the table.
    #
    # Validated first and cached second. A bad payload has to be a bad request
    # rather than a cache key.
    # Not keyed on who is asking, and that is a claim about the query rather
    # than a convenience: `_base_statement` narrows by soft-deletion and
    # nothing else, so two readers who may see this dataset see the same
    # aggregate. Permission is checked above, on every request, and never from
    # the cache. **If a resource ever scopes rows by principal — by
    # organization, by assignment — that scope has to enter this key**, or one
    # reader's total will be served to another. Asserted in `test_explorer`.
    return cache.aggregate(
        f"insights:{resource.key}",
        _cacheable(payload),
        depends_on=(resource.key,),
        producer=lambda: _insights(session, payload, resource=resource),
    )


def _cacheable(payload: dict[str, Any]) -> dict[str, Any]:
    """Only the parts of a request that change the answer.

    `page` and `page_size` do not: the aggregates are over the whole filtered
    set, which is the property that makes them worth computing in SQL at all.
    Including them would give every page of a list its own cache entry and the
    cache would never be hit twice.
    """
    return {
        key: value
        for key, value in payload.items()
        if key not in ("page", "page_size", "sort", "order", "columns")
    }


def _insights(session, payload: dict[str, Any], *, resource: Resource) -> dict[str, Any]:
    statement = apply_filters(_base_statement(resource), _query_args(payload), resource.fields)
    predicate = compile_tree(payload.get("condition_tree"), resource.fields)
    if predicate is not None:
        statement = statement.where(predicate)

    scope = statement.subquery()
    declared = resource.insight

    return {
        "resource_type": resource.key,
        "total": count_of(session, statement),
        "metrics": [_metric(session, scope, resource, metric) for metric in declared.metrics],
        "breakdowns": [
            _breakdown(session, scope, resource, name)
            for name in declared.breakdowns
            if name in resource.fields.by_name
        ],
        "trend": _trend(session, scope, resource, declared),
    }


def _metric(session, scope, resource: Resource, metric: Metric) -> dict[str, Any]:
    """One headline number, computed over the filtered set."""
    value: float
    if metric.kind in ("sum", "avg") and metric.field:
        column = _column_of(scope, resource, metric.field)
        aggregate = func.sum if metric.kind == "sum" else func.avg
        value = float(session.scalar(select(aggregate(sql_cast(column, Numeric))).select_from(scope)) or 0)
    else:
        statement = select(func.count()).select_from(scope)
        matched = statement
        if metric.field and metric.equals:
            column = _column_of(scope, resource, metric.field)
            matched = statement.where(_matches(column, metric.equals))
        counted = float(session.scalar(matched) or 0)
        if metric.kind == "share":
            # A share of nothing is zero rather than a division by zero, and
            # zero is the honest answer: no rows breached because no rows.
            everything = float(session.scalar(statement) or 0)
            value = round(100 * counted / everything, 1) if everything else 0.0
        else:
            value = counted

    return {
        "key": metric.key,
        "label": metric.label,
        "value": round(value, 2),
        "format": metric.format,
        "hint": metric.hint,
        # The filter that reproduces the number, so a tile can be clicked
        # through to the rows behind it (§44).
        "filter": (
            {metric.field: list(metric.equals)} if metric.field and metric.equals else {}
        ),
    }


def _matches(column, values: tuple[str, ...]):
    """`equals` as SQL, coping with the booleans a declaration spells as text."""
    if values in (("true",), ("false",)):
        return column.is_(values[0] == "true")
    return column.in_(list(values))


def _breakdown(session, scope, resource: Resource, name: str) -> dict[str, Any]:
    """One group-by, largest first, with the long tail collapsed."""
    column = _column_of(scope, resource, name)
    rows = session.execute(
        select(column.label("name"), func.count().label("value"))
        .select_from(scope)
        .group_by(column)
        .order_by(func.count().desc())
    ).all()

    head = rows[:BREAKDOWN_LIMIT]
    tail = sum(int(row.value) for row in rows[BREAKDOWN_LIMIT:])
    series = [{"name": str(row.name or "—"), "value": int(row.value)} for row in head]
    if tail:
        # Named rather than dropped: a chart whose slices do not add up to the
        # total is a chart nobody can reconcile with the list beside it.
        series.append({"name": f"{len(rows) - BREAKDOWN_LIMIT} others", "value": tail})

    field = resource.fields.by_name[name]
    return {"field": name, "label": field.title, "series": series, "distinct": len(rows)}
