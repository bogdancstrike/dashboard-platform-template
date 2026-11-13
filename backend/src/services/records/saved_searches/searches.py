"""Saved searches: list, read, create, change, remove, duplicate."""

from __future__ import annotations

from typing import Any

from src.core import audit, sharing
from src.core.clock import now
from src.models.personal import SavedSearch
from src.services.records import favorites
from src.services.records.explorer import resource_for
from src.services.records.saved_searches.access import (
    _make_sole_default,
    _owned_visible,
    _visible,
    _visible_statement,
)
from src.services.records.saved_searches.serializers import (
    KIND,
    _apply_favorite,
    _replace_members,
    _serialize,
    _state,
)
from src.services.records.saved_searches.validation import _validated


def list_searches(session, args, *, principal) -> dict[str, Any]:
    statement = _visible_statement(principal).order_by(
        SavedSearch.updated_at.desc(), SavedSearch.name.asc()
    )
    resource_type = str(args.get("resource_type") or "").strip()
    if resource_type:
        resource_for(resource_type, principal=principal)
        statement = statement.where(SavedSearch.resource_type == resource_type)
    rows = session.scalars(statement).unique().all()
    # One query for the whole panel's stars, then sorted here: `is_favorite`
    # lives in `favorites` now (§38), and this drawer's own tooltip has said
    # "Add to favourites" all along while writing somewhere `/favorites` could
    # not see.
    starred = favorites.favorite_ids(session, principal, resource_type=KIND)
    rows = sorted(rows, key=lambda row: str(row.id) not in starred)
    sharing.prefetch_members(session, KIND, [row.id for row in rows])
    return {
        "items": [_serialize(session, row, principal, starred=starred) for row in rows],
        "total": len(rows),
    }


def get(session, search_id: Any, *, principal, mark_used: bool = False) -> dict[str, Any]:
    row = _visible(session, search_id, principal)
    resource_for(row.resource_type, principal=principal)
    if mark_used:
        row.use_count = int(row.use_count or 0) + 1
        row.last_used_at = now()
        session.flush()
    return _serialize(session, row, principal)


def create(session, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    values = _validated(payload, principal=principal, partial=False)
    members = values.pop("member_ids")
    row = SavedSearch(owner_id=principal.user_id, organization_id=principal.organization_id, **values)
    session.add(row)
    session.flush()
    _replace_members(session, row, members, principal=principal)
    _apply_favorite(session, row, payload, principal=principal)
    _make_sole_default(session, row)
    audit.record(
        session, action="CREATE", resource_type="saved_search", resource_id=row.id,
        resource_label=row.name, principal=principal, after=_state(row),
        message=f"created saved search {row.name}", activity=False,
    )
    return _serialize(session, row, principal)


def update(session, search_id: Any, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    row = _owned_visible(session, search_id, principal)
    values = _validated(payload, principal=principal, partial=True, existing=row)
    members = values.pop("member_ids", None)
    before = _state(row)
    for key, value in values.items():
        setattr(row, key, value)
    if members is not None:
        _replace_members(session, row, members, principal=principal)
    session.flush()
    _apply_favorite(session, row, payload, principal=principal)
    _make_sole_default(session, row)
    action = "SHARE" if "scope" in values or members is not None else "UPDATE"
    audit.record(
        session, action=action, resource_type="saved_search", resource_id=row.id,
        resource_label=row.name, principal=principal, before=before, after=_state(row),
        message=f"updated saved search {row.name}", activity=False,
    )
    return _serialize(session, row, principal)


def remove(session, search_id: Any, *, principal) -> None:
    row = _owned_visible(session, search_id, principal)
    before = _state(row)
    row.deleted_at = now()
    audit.record(
        session, action="DELETE", resource_type="saved_search", resource_id=row.id,
        resource_label=row.name, principal=principal, before=before,
        message=f"deleted saved search {row.name}", activity=False,
    )


def duplicate(session, search_id: Any, *, principal) -> dict[str, Any]:
    source = _visible(session, search_id, principal)
    resource_for(source.resource_type, principal=principal)
    row = SavedSearch(
        name=f"{source.name} (copy)"[:200], description=source.description,
        resource_type=source.resource_type, owner_id=principal.user_id,
        organization_id=principal.organization_id, scope="PRIVATE",
        condition_tree=source.condition_tree, condition_text=source.condition_text,
        filters=source.filters, query_text=source.query_text, sort=source.sort,
        order=source.order, columns=source.columns, page_size=source.page_size,
        # No star and not the default: a copy is a new object nobody has
        # starred, and `is_favorite` is not a column this writes any more.
        view_mode=source.view_mode, is_default=False,
        rule_count=source.rule_count, use_count=0,
    )
    session.add(row)
    session.flush()
    audit.record(
        session, action="CREATE", resource_type="saved_search", resource_id=row.id,
        resource_label=row.name, principal=principal, after=_state(row),
        metadata={"duplicated_from": str(source.id)},
        message=f"duplicated saved search {source.name}", activity=False,
    )
    return _serialize(session, row, principal)
