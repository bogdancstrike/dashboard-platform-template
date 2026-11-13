"""Members, favourites, and a saved search as the API returns it."""

from __future__ import annotations

from typing import Any

from src.core import sharing
from src.core.clock import iso
from src.models.personal import SavedSearch
from src.services.records import favorites

#: The polymorphic key this kind of saved thing shares under. One string is
#: what adopting `core/sharing` costs (§5, §46).
KIND = "saved_search"


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
