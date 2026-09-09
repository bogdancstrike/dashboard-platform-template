"""Saved Data Explorer questions with owner-only mutation and SQL visibility.

The service stores both the question and its presentation.  Read access is
resolved by one SQL predicate (owner, public, or explicit share); mutation is
always restricted to the owner, irrespective of visibility.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from src.core import audit, sharing
from src.core.clock import iso, now
from src.core.errors import NotFoundError, ValidationError
from src.core.pagination import parse_uuid
from src.core.rules import compile_tree, describe_tree, rule_count
from src.models.personal import SavedSearch
from src.services import favorites
from src.services.explorer import resource_for

#: The polymorphic key this kind of saved thing shares under. One string is
#: what adopting `core/sharing` costs (§5, §46).
KIND = "saved_search"

VIEW_MODES = frozenset({"table", "list", "cards", "compact"})
ORDERS = frozenset({"asc", "desc"})

#: Holding this is what separates "I keep my own searches" from "I decide what
#: other people see". OPERATOR and VIEWER have their own searches and no way to
#: publish one.
SHARE_PERMISSION = "searches.share"


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


def _make_sole_default(session, row: SavedSearch) -> None:
    """One default per person per dataset, enforced on the way in (§46).

    "Which of my saved searches should this list open with" has one answer, so
    marking a second one demotes the first rather than being refused. A refusal
    would be an error message asking somebody to go and unmark the old default
    themselves — a chore with no decision in it.

    Not a partial unique index, for that reason: an index can only reject the
    new row, and rejecting is the wrong outcome.
    """
    if not row.is_default:
        return
    demoted = session.scalars(
        select(SavedSearch).where(
            SavedSearch.owner_id == row.owner_id,
            SavedSearch.resource_type == row.resource_type,
            SavedSearch.is_default.is_(True),
            SavedSearch.id != row.id,
            SavedSearch.deleted_at.is_(None),
        )
    ).unique().all()
    for other in demoted:
        other.is_default = False
    if demoted:
        session.flush()


def _visible_statement(principal):
    return (
        select(SavedSearch)
        .options(selectinload(SavedSearch.owner))
        .where(
            SavedSearch.deleted_at.is_(None),
            sharing.visibility(SavedSearch, KIND, principal),
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
    sharing.require_owner(row, principal, kind="saved search")
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

    # Checked on the change, not on every save: a role losing the permission
    # must not make its owner's existing searches unsavable.
    changing = existing is None or str(payload.get("scope", existing.scope)).upper() != existing.scope
    scope = sharing.scope_of(
        payload.get("scope", existing.scope if existing else "PRIVATE"),
        principal=principal if changing else None,
        share_permission=SHARE_PERMISSION,
    )
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
    # `is_default` is a fact about the search; `is_favorite` is a fact about a
    # reader, and two readers can disagree about the same search — so it goes
    # in `favorites` rather than in a column here. See `_apply_favorite`.
    if "is_default" in payload or not partial:
        out["is_default"] = bool(
            payload.get("is_default", getattr(existing, "is_default", False))
        )

    if "member_ids" in payload or not partial:
        wanted = sharing.requested_members(payload)
        if wanted:
            principal.require(SHARE_PERMISSION)
        out["member_ids"] = wanted
    return out


def _member_ids(session, row: SavedSearch) -> list[Any]:
    return sharing.member_ids(session, KIND, row.id)


def _replace_members(
    session, row: SavedSearch, member_ids: list[str], *, principal, owner_id: Any = None,
) -> None:
    sharing.replace_members(
        session, KIND, row.id, member_ids,
        principal=principal,
        owner_id=owner_id if owner_id is not None else row.owner_id,
    )


def _members(session, row: SavedSearch) -> list[dict[str, str]]:
    return sharing.members(session, KIND, row.id)


def _apply_favorite(session, row: SavedSearch, payload: Any, *, principal) -> None:
    """Star or unstar this search, if the payload said anything about it.

    Not a field of the search, for the reason `_validated` no longer accepts
    it: a star is a fact about a reader, and two readers may disagree about
    the same shared search. Writing it into a column made the drawer's own
    "Add to favourites" tooltip a lie (§38).
    """
    body = payload if isinstance(payload, dict) else {}
    if "is_favorite" not in body:
        return
    favorites.set_favorite(
        session,
        principal,
        resource_type=KIND,
        resource_id=row.id,
        label=row.name,
        # The route that actually serves one, `/search/saved/:searchId` — not
        # a query string I would have had to keep in step with the router.
        url=f"/search/saved/{row.id}",
        icon="search",
        wanted=bool(body["is_favorite"]),
    )


def _serialize(
    session, row: SavedSearch, principal, *, starred: set[str] | None = None
) -> dict[str, Any]:
    """One saved search as a reader sees it.

    `starred` is the whole panel's stars, fetched once by `list_searches`.
    Without it, serialising twenty searches is twenty extra queries.
    """
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
        # From `favorites`, not from the column.
        "is_favorite": (
            str(row.id) in starred
            if starred is not None
            else favorites.is_favorite_of(
                session, principal, resource_type=KIND, resource_id=row.id
            )
        ),
        "is_default": row.is_default,
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
        # Not `is_favorite`: an audit diff records what *the search* changed,
        # and starring one is a fact about a reader rather than about it.
        "view_mode": row.view_mode,
    }
