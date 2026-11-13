"""What can be bookmarked, and setting a favourite."""

from __future__ import annotations

from typing import Any

from sqlalchemy import func, select

from src.core.errors import ConflictError
from src.models.personal import Favorite

#: How many bookmarks one person may keep.
#:
#: A shortcut bar with two hundred things in it is not a shortcut bar. The
#: refusal names the number so somebody can tidy rather than wonder.
MAX_FAVORITES = 100


#: How many recents to keep per person, and how many the page shows.
#:
#: Recents are a by-product, so the list is trimmed rather than paged: fifty is
#: more than anybody scrolls and few enough that the table stays small.
MAX_RECENTS = 50


#: The resource types a bookmark may point at.
#:
#: Not a closed list of *strings* somebody has to remember, but the union of
#: what the platform actually addresses: the explorer's datasets plus the
#: personal objects with their own pages. Checked so a bookmark cannot be made
#: to something no route serves — a favourite that 404s is worse than no
#: favourite.
#: Spelled exactly as the services that own them spell it —
#: `saved_searches.KIND` is `saved_search`, and a bookmark typed `search`
#: would be one `favorite_ids` never found.
_EXTRA_TYPES = ("saved_search", "report", "dashboard", "board")


def bookmarkable() -> tuple[str, ...]:
    """Every resource type a bookmark may name, derived from the registry."""
    from src.services.records import explorer

    return tuple(sorted({*explorer.resources(), *_EXTRA_TYPES}))


def is_favorite_of(session, principal, *, resource_type: str, resource_id: Any) -> bool:
    """Whether this person has starred one thing.

    For a single row. A page should use `favorite_ids` instead — a lookup per
    item is how a list of twenty-five becomes twenty-six queries.
    """
    if principal is None or not getattr(principal, "user_id", None):
        return False
    return bool(
        session.scalar(
            select(Favorite.id).where(
                Favorite.user_id == principal.user_id,
                Favorite.resource_type == resource_type,
                Favorite.resource_id == str(resource_id),
            )
        )
    )


def favorite_ids(session, principal, *, resource_type: str) -> set[str]:
    """Every id of this type this person has starred, in one query.

    What a list endpoint calls once and then checks in memory, so serialising
    twenty-five rows costs one query rather than twenty-five.
    """
    if principal is None or not getattr(principal, "user_id", None):
        return set()
    return {
        row[0]
        for row in session.execute(
            select(Favorite.resource_id).where(
                Favorite.user_id == principal.user_id,
                Favorite.resource_type == resource_type,
            )
        ).all()
    }


def set_favorite(
    session,
    principal,
    *,
    resource_type: str,
    resource_id: Any,
    label: str,
    url: str,
    icon: str = "",
    wanted: bool,
) -> bool:
    """Star or unstar one thing. Returns whether it is starred afterwards.

    Idempotent in both directions, because a star is a toggle somebody
    double-clicks. The label and url are stored rather than derived: a
    bookmark has to keep working when a record is renamed *and* when a route's
    shape changes for new records only, which is what the model's own comment
    says.
    """
    if principal is None or not getattr(principal, "user_id", None):
        return False

    existing = session.scalar(
        select(Favorite).where(
            Favorite.user_id == principal.user_id,
            Favorite.resource_type == resource_type,
            Favorite.resource_id == str(resource_id),
        )
    )

    if not wanted:
        if existing is not None:
            session.delete(existing)
            session.flush()
        return False

    if existing is not None:
        # Kept fresh on a re-star: a report renamed since it was bookmarked
        # should show its current name.
        existing.label = label[:240] or existing.label
        existing.url = url[:500] or existing.url
        if icon:
            existing.icon = icon
        return True

    _refuse_if_full(session, principal)
    session.add(
        Favorite(
            user_id=principal.user_id,
            resource_type=resource_type,
            resource_id=str(resource_id),
            label=label[:240] or resource_type,
            url=url[:500],
            icon=icon or None,
            position=_next_position(session, principal),
        )
    )
    session.flush()
    return True


def _refuse_if_full(session, principal) -> None:
    held = (
        session.scalar(
            select(func.count())
            .select_from(Favorite)
            .where(Favorite.user_id == principal.user_id)
        )
        or 0
    )
    if held >= MAX_FAVORITES:
        raise ConflictError(
            f"You have {held} favourites, which is the limit. Remove one first.",
            details={"held": held, "maximum": MAX_FAVORITES},
        )


def _next_position(session, principal) -> int:
    """The end of the list. New bookmarks do not jump the arrangement."""
    highest = session.scalar(
        select(func.max(Favorite.position)).where(Favorite.user_id == principal.user_id)
    )
    return int(highest or 0) + 1
