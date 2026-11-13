"""A saved search payload, checked."""

from __future__ import annotations

from typing import Any

from src.core.cleaners import bounded_name, flag, json_object, text
from src.core.errors import ValidationError
from src.core.pagination import PAGE_SIZE_CHOICES
from src.core.rules import compile_tree, describe_tree, rule_count
from src.core.shared_fields import members_step, scope_step
from src.core.validation import Field, Schema
from src.models.personal import SavedSearch
from src.services.records.explorer import resource_for
from src.services.records.saved_searches.access import (
    ORDERS,
    SHARE_PERMISSION,
    VIEW_MODES,
)


def _resource(out: dict[str, Any], ctx) -> None:
    ctx.extra["resource"] = resource_for(
        ctx.value("resource_type", inherit=True), principal=ctx.principal
    )


def _condition(out: dict[str, Any], ctx) -> None:
    fields = ctx.extra["resource"].fields
    tree = ctx.value("condition_tree", inherit=True)
    if tree is not None and not isinstance(tree, dict):
        raise ValidationError("condition_tree must be an object or null")
    # Validation and the inspector deliberately walk the same tree the query
    # endpoint will compile; a saved question can never be accepted but fail on run.
    compile_tree(tree, fields)
    if ctx.wants("condition_tree") or ctx.sent("resource_type"):
        out["condition_tree"] = tree
        out["condition_text"] = describe_tree(tree, fields) or None
        out["rule_count"] = rule_count(tree)


def _query_text(raw: Any, ctx) -> str | None:
    query_text = str(raw or "").strip()
    if len(query_text) > 500:
        raise ValidationError("query_text must be at most 500 characters")
    return query_text or None


def _sort(raw: Any, ctx) -> str:
    resource = ctx.extra["resource"]
    sort = str(raw or resource.default_sort)
    if sort not in resource.fields.by_name or not resource.fields.by_name[sort].sortable:
        raise ValidationError("sort is not available for this resource", details={"field": "sort"})
    return sort


def _order(raw: Any, ctx) -> str:
    order = str(raw).lower()
    if order not in ORDERS:
        raise ValidationError("order must be asc or desc", details={"field": "order"})
    return order


def _columns(out: dict[str, Any], ctx) -> None:
    resource = ctx.extra["resource"]
    columns = ctx.value("columns", list(resource.default_columns), inherit=True)
    if not isinstance(columns, list) or not columns:
        raise ValidationError("columns must be a non-empty array")
    columns = list(dict.fromkeys(str(value) for value in columns))
    unknown_columns = [value for value in columns if value not in resource.fields.by_name]
    if unknown_columns:
        raise ValidationError("Unknown result column.", details={"columns": unknown_columns})
    if ctx.wants("columns"):
        out["columns"] = columns[:30]


def _page_size(raw: Any, ctx) -> int:
    try:
        page_size = int(raw)
    except (TypeError, ValueError) as exc:
        raise ValidationError("page_size must be an integer") from exc
    # The pager's own set rather than a second copy of it: a saved view's page
    # size has to be a value the pager can show as selected.
    if page_size not in PAGE_SIZE_CHOICES:
        raise ValidationError(
            "page_size must be " + ", ".join(str(size) for size in PAGE_SIZE_CHOICES)
        )
    return page_size


def _view_mode(raw: Any, ctx) -> str:
    view_mode = str(raw)
    if view_mode not in VIEW_MODES:
        raise ValidationError("view_mode is not supported", details={"field": "view_mode"})
    return view_mode


#: `is_default` is a fact about the search; `is_favorite` is a fact about a
#: reader, and two readers can disagree about the same search — so it goes in
#: `favorites` rather than in a column here (see `_apply_favorite`); it is
#: accepted in the payload and handled there.
_SCHEMA = Schema(
    [
        _resource,
        Field("name", bounded_name()),
        Field("description", text(2000, squash=True, empty=None)),
        Field("resource_type", lambda raw, ctx: ctx.extra["resource"].key),
        scope_step(SHARE_PERMISSION),
        _condition,
        Field("filters", json_object("filters must be an object"), always=True, inherit=True),
        Field("query_text", _query_text),
        Field("sort", _sort, always=True, inherit=True),
        Field("order", _order, default="desc", always=True, inherit=True),
        _columns,
        Field("page_size", _page_size, default=25, always=True, inherit=True),
        Field("view_mode", _view_mode, default="table", always=True, inherit=True),
        Field("is_default", flag, default=False, inherit=True),
        members_step(SHARE_PERMISSION),
    ],
    not_object="The saved search must be a JSON object.",
    unknown="Unknown saved-search field.",
    extra_allowed={"scope", "member_ids", "columns", "condition_tree", "is_favorite"},
)


def _validated(
    payload: Any, *, principal, partial: bool, existing: SavedSearch | None = None,
) -> dict[str, Any]:
    return _SCHEMA.validate(payload, principal=principal, partial=partial, existing=existing)
