"""Running a query against a dataset: statement, arguments, columns, serialisation."""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any
from uuid import UUID

from sqlalchemy import Select, select

from src.core.errors import ValidationError
from src.core.pagination import envelope, parse_page
from src.core.query import apply_filters, apply_sort, count_of, facets_for
from src.core.rules import compile_tree, describe_tree, rule_count
from src.services.records.explorer.model import Resource
from src.services.records.explorer.registry import resource_for

#: Reading a dataset and taking a copy of it away are different privileges.
EXPORT_PERMISSION = "records.export"


def run(session, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    """Execute a simple and/or nested query entirely in PostgreSQL."""
    if not isinstance(payload, dict):
        raise ValidationError("The query must be a JSON object.")
    resource = resource_for(payload.get("resource_type"), principal=principal)
    tree = payload.get("condition_tree")
    if tree is not None and not isinstance(tree, dict):
        raise ValidationError("condition_tree must be an object or null")

    page = parse_page(payload, default_sort=resource.default_sort)
    statement = apply_filters(_base_statement(resource), _query_args(payload), resource.fields)
    predicate = compile_tree(tree, resource.fields)
    if predicate is not None:
        statement = statement.where(predicate)

    total = count_of(session, statement)
    # One GROUP BY per faceted column, so it is asked for rather than assumed:
    # the explorer's filtering happens in the condition builder, and computing
    # menus nobody renders is work the reader waits for.
    facets = (
        facets_for(session, statement, resource.fields)
        if bool(payload.get("facets"))
        else {}
    )
    statement = apply_sort(statement, page, resource.fields, default=resource.default_sort)
    rows = session.scalars(statement.offset(page.offset).limit(page.page_size)).unique().all()
    columns = _columns(payload.get("columns"), resource)

    return envelope(
        [_serialize(row, resource, columns) for row in rows],
        total,
        page,
        resource_type=resource.key,
        columns=columns,
        fields=resource.fields.describe(),
        facets=facets,
        condition_text=describe_tree(tree, resource.fields),
        rule_count=rule_count(tree),
        # Echoed so the client highlights the term that was actually searched
        # for, not the one currently in the box: the two differ for as long as
        # the request is in flight, and highlighting the newer one marks
        # matches that are not there.
        query_text=str(payload.get("query_text") or "").strip(),
        searchable=[field.name for field in resource.fields.searchable],
    )


def _base_statement(resource: Resource) -> Select:
    statement = select(resource.model)
    deleted = getattr(resource.model, "deleted_at", None)
    return statement.where(deleted.is_(None)) if deleted is not None else statement


def _query_args(payload: dict[str, Any]) -> dict[str, Any]:
    filters = payload.get("filters") or {}
    if not isinstance(filters, dict):
        raise ValidationError("filters must be an object")
    out = dict(filters)
    if payload.get("query_text") not in (None, ""):
        out["q"] = payload["query_text"]
    return out


def _columns(raw: Any, resource: Resource) -> list[str]:
    if raw in (None, []):
        return list(resource.default_columns)
    if not isinstance(raw, list):
        raise ValidationError("columns must be an array")
    columns = list(dict.fromkeys(str(item) for item in raw))
    unknown = [name for name in columns if name not in resource.fields.by_name]
    if unknown:
        raise ValidationError("Unknown result column.", details={"columns": unknown})
    if not columns:
        raise ValidationError("At least one result column is required.")
    return columns[:30]


def _serialize(row: Any, resource: Resource, columns: list[str]) -> dict[str, Any]:
    item = {"id": str(row.id)}
    for name in columns:
        canonical = resource.fields.by_name[name].name
        item[canonical] = _json_value(getattr(row, canonical, None))
    return item


def _json_value(value: Any) -> Any:
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, tuple):
        return list(value)
    return value
