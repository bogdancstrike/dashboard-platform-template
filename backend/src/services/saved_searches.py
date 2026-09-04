"""Saved Data Explorer questions with owner-only mutation and SQL visibility.

The service stores both the question and its presentation.  Read access is
resolved by one SQL predicate (owner, public, or explicit share); mutation is
always restricted to the owner, irrespective of visibility.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import String, cast, delete, or_, select
from sqlalchemy.orm import selectinload

from src.core import audit
from src.core.clock import iso, now
from src.core.errors import ForbiddenError, NotFoundError, ValidationError
from src.core.pagination import parse_uuid
from src.core.rules import compile_tree, describe_tree, rule_count
from src.models.personal import ResourceShare, SavedSearch
from src.services.explorer import resource_for

SCOPES = frozenset({"PRIVATE", "SHARED", "PUBLIC"})
VIEW_MODES = frozenset({"table", "list", "cards", "compact"})
ORDERS = frozenset({"asc", "desc"})

#: Holding this is what separates "I keep my own searches" from "I decide what
#: other people see". OPERATOR and VIEWER have their own searches and no way to
#: publish one.
SHARE_PERMISSION = "searches.share"

#: An audience larger than this is what `PUBLIC` is for.
MAX_MEMBERS = 100


def list_searches(session, args, *, principal) -> dict[str, Any]:
    statement = _visible_statement(principal).order_by(
        SavedSearch.is_favorite.desc(), SavedSearch.updated_at.desc(), SavedSearch.name.asc()
    )
    resource_type = str(args.get("resource_type") or "").strip()
    if resource_type:
        resource_for(resource_type, principal=principal)
        statement = statement.where(SavedSearch.resource_type == resource_type)
    rows = session.scalars(statement).unique().all()
    return {"items": [_serialize(session, row, principal) for row in rows], "total": len(rows)}


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
        view_mode=source.view_mode, is_favorite=False, is_default=False,
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


def transfer(session, search_id: Any, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    """Hand a saved search to somebody else (§5).

    An explicit action rather than a field on `update`, because it is the one
    change the current owner cannot undo: afterwards they are a member like any
    other. They are kept as a member for exactly that reason — losing sight of
    a search you built, the moment you hand it over, is not a handover anybody
    would risk making.
    """
    from src.models.identity import User

    row = _owned_visible(session, search_id, principal)
    principal.require(SHARE_PERMISSION)
    if not isinstance(payload, dict):
        raise ValidationError("The transfer must be a JSON object.")

    new_owner_id = parse_uuid(payload.get("owner_id"), field="owner_id")
    if new_owner_id == row.owner_id:
        raise ValidationError("This saved search already belongs to that person.")
    new_owner = session.scalars(
        select(User).where(
            User.id == new_owner_id, User.deleted_at.is_(None), User.status == "ACTIVE"
        )
    ).one_or_none()
    if new_owner is None:
        raise ValidationError(
            "That person cannot receive a saved search.",
            details={"owner_id": str(new_owner_id)},
        )

    before = _state(row)
    previous_owner_id = row.owner_id
    # Assigned through the relationship, not the raw column: the serializer
    # reads `row.owner`, and setting only the id leaves it pointing at the
    # person who just gave the search away.
    row.owner = new_owner
    # The new owner needs no share of their own, and the old one keeps a
    # read-only place on the list they used to own.
    members = [str(user_id) for user_id in _member_ids(session, row) if user_id != new_owner_id]
    members.append(str(previous_owner_id))
    session.flush()
    _replace_members(session, row, members, principal=principal, owner_id=new_owner_id)

    audit.record(
        session, action="TRANSFER", resource_type="saved_search", resource_id=row.id,
        resource_label=row.name, principal=principal, before=before, after=_state(row),
        metadata={"from_owner_id": str(previous_owner_id), "to_owner_id": str(new_owner_id)},
        message=f"transferred saved search {row.name} to {new_owner.full_name}",
        activity=False,
    )
    return _serialize(session, row, principal)


def _visible_statement(principal):
    shared_ids = select(ResourceShare.resource_id).where(
        ResourceShare.user_id == principal.user_id,
        ResourceShare.resource_type == "saved_search",
        ResourceShare.permission == "VIEW",
    )
    return (
        select(SavedSearch)
        .options(selectinload(SavedSearch.owner))
        .where(
            SavedSearch.deleted_at.is_(None),
            or_(
                SavedSearch.owner_id == principal.user_id,
                SavedSearch.scope == "PUBLIC",
                cast(SavedSearch.id, String).in_(shared_ids),
            ),
        )
    )


def _visible(session, search_id: Any, principal) -> SavedSearch:
    identifier = parse_uuid(search_id, field="search_id")
    row = session.scalars(_visible_statement(principal).where(SavedSearch.id == identifier)).unique().one_or_none()
    if row is None:
        raise NotFoundError("The saved search does not exist or is private.")
    return row


def _owned_visible(session, search_id: Any, principal) -> SavedSearch:
    row = _visible(session, search_id, principal)
    if row.owner_id != principal.user_id:
        raise ForbiddenError(
            "Only the owner may change this saved search.",
            details={"owner_id": str(row.owner_id), "search_id": str(row.id)},
        )
    return row


def _validated(
    payload: Any, *, principal, partial: bool, existing: SavedSearch | None = None,
) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise ValidationError("The saved search must be a JSON object.")
    allowed = {
        "name", "description", "resource_type", "scope", "member_ids",
        "condition_tree", "filters", "query_text", "sort", "order", "columns",
        "page_size", "view_mode", "is_favorite", "is_default",
    }
    unknown = set(payload) - allowed
    if unknown:
        raise ValidationError("Unknown saved-search field.", details={"fields": sorted(unknown)})

    resource_key = payload.get("resource_type", existing.resource_type if existing else None)
    resource = resource_for(resource_key, principal=principal)
    out: dict[str, Any] = {}

    if not partial or "name" in payload:
        name = " ".join(str(payload.get("name") or "").split())
        if not name or len(name) > 200:
            raise ValidationError("name must contain 1 to 200 characters", details={"field": "name"})
        out["name"] = name
    if "description" in payload or not partial:
        description = " ".join(str(payload.get("description") or "").split())
        out["description"] = description[:2000] or None
    if not partial or "resource_type" in payload:
        out["resource_type"] = resource.key

    scope = str(payload.get("scope", existing.scope if existing else "PRIVATE")).upper()
    if scope not in SCOPES:
        raise ValidationError("scope must be PRIVATE, SHARED or PUBLIC", details={"field": "scope"})
    if scope != "PRIVATE" and (existing is None or existing.scope != scope):
        # Checked on the change, not on every save: a role losing the
        # permission must not make its owner's existing searches unsavable.
        principal.require(SHARE_PERMISSION)
    if not partial or "scope" in payload:
        out["scope"] = scope

    tree = payload.get("condition_tree", existing.condition_tree if existing else None)
    if tree is not None and not isinstance(tree, dict):
        raise ValidationError("condition_tree must be an object or null")
    # Validation and the inspector deliberately walk the same tree the query
    # endpoint will compile; a saved question can never be accepted but fail on run.
    compile_tree(tree, resource.fields)
    if not partial or "condition_tree" in payload or "resource_type" in payload:
        out["condition_tree"] = tree
        out["condition_text"] = describe_tree(tree, resource.fields) or None
        out["rule_count"] = rule_count(tree)

    filters = payload.get("filters", existing.filters if existing else {}) or {}
    if not isinstance(filters, dict):
        raise ValidationError("filters must be an object")
    if not partial or "filters" in payload:
        out["filters"] = filters
    if not partial or "query_text" in payload:
        query_text = str(payload.get("query_text") or "").strip()
        if len(query_text) > 500:
            raise ValidationError("query_text must be at most 500 characters")
        out["query_text"] = query_text or None

    sort = str(payload.get("sort", existing.sort if existing else resource.default_sort) or resource.default_sort)
    if sort not in resource.fields.by_name or not resource.fields.by_name[sort].sortable:
        raise ValidationError("sort is not available for this resource", details={"field": "sort"})
    order = str(payload.get("order", existing.order if existing else "desc")).lower()
    if order not in ORDERS:
        raise ValidationError("order must be asc or desc", details={"field": "order"})
    if not partial or "sort" in payload:
        out["sort"] = sort
    if not partial or "order" in payload:
        out["order"] = order

    columns = payload.get("columns", existing.columns if existing else list(resource.default_columns))
    if not isinstance(columns, list) or not columns:
        raise ValidationError("columns must be a non-empty array")
    columns = list(dict.fromkeys(str(value) for value in columns))
    unknown_columns = [value for value in columns if value not in resource.fields.by_name]
    if unknown_columns:
        raise ValidationError("Unknown result column.", details={"columns": unknown_columns})
    if not partial or "columns" in payload:
        out["columns"] = columns[:30]

    page_size = payload.get("page_size", existing.page_size if existing else 25)
    try:
        page_size = int(page_size)
    except (TypeError, ValueError) as exc:
        raise ValidationError("page_size must be an integer") from exc
    if page_size not in (10, 25, 50, 100, 200):
        raise ValidationError("page_size must be 10, 25, 50, 100 or 200")
    if not partial or "page_size" in payload:
        out["page_size"] = page_size

    view_mode = str(payload.get("view_mode", existing.view_mode if existing else "table"))
    if view_mode not in VIEW_MODES:
        raise ValidationError("view_mode is not supported", details={"field": "view_mode"})
    if not partial or "view_mode" in payload:
        out["view_mode"] = view_mode
    for flag in ("is_favorite", "is_default"):
        if flag in payload or not partial:
            out[flag] = bool(payload.get(flag, getattr(existing, flag, False)))

    if "member_ids" in payload or not partial:
        members = payload.get("member_ids") or []
        if not isinstance(members, list):
            raise ValidationError("member_ids must be an array")
        if members:
            principal.require(SHARE_PERMISSION)
        out["member_ids"] = list(dict.fromkeys(str(value) for value in members))[:MAX_MEMBERS]
    return out


def _member_ids(session, row: SavedSearch) -> list[Any]:
    return list(session.scalars(
        select(ResourceShare.user_id).where(
            ResourceShare.resource_type == "saved_search",
            ResourceShare.resource_id == str(row.id),
        )
    ).all())


def _replace_members(
    session, row: SavedSearch, member_ids: list[str], *, principal, owner_id: Any = None,
) -> None:
    """Set the explicit audience, replacing whatever was there.

    Replacement rather than merge, because the UI edits the whole list: a
    member removed on screen has to disappear here, and an "add" endpoint that
    cannot remove leaves an audience nobody can shrink.
    """
    from src.models.identity import User

    owner = owner_id if owner_id is not None else row.owner_id
    identifiers = [parse_uuid(value, field="member_id") for value in member_ids]
    # The owner already sees it; a share row for them would be a second answer
    # to the same question, and `can_edit` would then depend on which one won.
    identifiers = [value for value in dict.fromkeys(identifiers) if value != owner]
    existing_ids = set(session.scalars(
        select(User.id).where(User.id.in_(identifiers), User.deleted_at.is_(None), User.status == "ACTIVE")
    ).all()) if identifiers else set()
    missing = set(identifiers) - existing_ids
    if missing:
        raise ValidationError("One or more shared members do not exist.", details={"member_ids": sorted(map(str, missing))})

    session.execute(delete(ResourceShare).where(
        ResourceShare.resource_type == "saved_search",
        ResourceShare.resource_id == str(row.id),
    ))
    for user_id in identifiers:
        session.add(ResourceShare(
            resource_type="saved_search", resource_id=str(row.id), user_id=user_id,
            shared_by_id=principal.user_id, permission="VIEW",
        ))


def _members(session, row: SavedSearch) -> list[dict[str, str]]:
    from src.models.identity import User

    rows = session.execute(
        select(User.id, User.full_name, User.email)
        .join(ResourceShare, ResourceShare.user_id == User.id)
        .where(ResourceShare.resource_type == "saved_search", ResourceShare.resource_id == str(row.id))
        .order_by(User.full_name)
    ).all()
    return [{"id": str(user_id), "name": name, "email": email} for user_id, name, email in rows]


def _serialize(session, row: SavedSearch, principal) -> dict[str, Any]:
    return {
        "id": str(row.id), "name": row.name, "description": row.description,
        "resource_type": row.resource_type, "scope": row.scope,
        "owner": {
            "id": str(row.owner_id),
            "name": row.owner.full_name if row.owner else "Former user",
            "email": row.owner.email if row.owner else None,
        },
        "can_edit": row.owner_id == principal.user_id,
        "members": _members(session, row),
        "condition_tree": row.condition_tree, "condition_text": row.condition_text,
        "filters": row.filters or {}, "query_text": row.query_text or "",
        "sort": row.sort, "order": row.order, "columns": list(row.columns or []),
        "page_size": row.page_size, "view_mode": row.view_mode,
        "is_favorite": row.is_favorite, "is_default": row.is_default,
        "rule_count": row.rule_count, "use_count": row.use_count,
        "last_used_at": iso(row.last_used_at), "created_at": iso(row.created_at),
        "updated_at": iso(row.updated_at),
    }


def _state(row: SavedSearch) -> dict[str, Any]:
    return {
        "name": row.name, "description": row.description, "resource_type": row.resource_type,
        "scope": row.scope, "condition_tree": row.condition_tree, "filters": row.filters,
        "query_text": row.query_text, "sort": row.sort, "order": row.order,
        "columns": list(row.columns or []), "page_size": row.page_size,
        "view_mode": row.view_mode, "is_favorite": row.is_favorite,
    }
