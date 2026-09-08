"""Bookmarks and recents — one store for "what have I starred" (§38, §39).

There were two, and the older UI already lied about it. The saved-search
drawer's own tooltip says **"Add to favourites"** and wrote
`SavedSearch.is_favorite`; the reports page did the same with
`Report.is_favorite`; and `favorites` — a table whose docstring reads "a
bookmark on anything addressable" — had no service at all. So a reader could
star a saved search, be told it went to their favourites, open `/favorites`
and find nothing. Two stores for one fact, and the fact people would act on
was in whichever one they had not looked at.

This module is the single store. Six decisions worth stating.

**A star is a `Favorite` row, whatever was starred.** Which means one query
answers "what have I bookmarked" across saved searches, reports, records and
anything else addressable — and adding a bookmarkable thing is a call to
`set_favorite`, not a new boolean column.

**`is_favorite` stays in the API and stops being stored.** The reports and
saved-search endpoints still publish and accept it, because their pages are
built on it and a field that vanished would be a needless break; it is now
read from and written to *this* store. `is_favorite_of` answers one row and
`favorite_ids` answers a whole page in one query, because the alternative is
a lookup per item.

**The old columns are migrated once and then cleared.** `--sync-favorites`
copies them into `Favorite` rows and sets them false, so `is_favorite = false`
everywhere is the steady state and `--check` can assert exactly that. Keeping
them in sync would be maintaining the second store this module exists to
remove.

**Nothing needs a permission.** These are your own bookmarks, and being signed
in is the qualification — the same argument `/settings/security` makes.

**Order is somebody's arrangement, not a sort.** `Favorite.position` exists
because a bookmark list is a *shortcut bar*: the order is a decision the
reader made, and re-sorting it by name or date would throw that away. New
bookmarks land at the end.

**A recent is not a favourite and is not editable.** `RecentItem` is a
by-product of visiting things; it has a visit count and a last-visited moment,
and the only thing anybody does to it is look at it or clear the lot. Mixing
the two lists would make the deliberate one indistinguishable from the
automatic one.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import func, select

from src.core import audit
from src.core.clock import iso, now
from src.core.errors import ConflictError, NotFoundError, ValidationError
from src.core.pagination import parse_uuid
from src.models.personal import Favorite, RecentItem

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
    from src.services import explorer

    return tuple(sorted({*explorer.resources(), *_EXTRA_TYPES}))


# ── the one store, for other services to use ────────────────────────────


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


# ── the page ────────────────────────────────────────────────────────────


def _serialise(row) -> dict[str, Any]:
    return {
        "id": str(row.id),
        "resource_type": row.resource_type,
        "resource_id": row.resource_id,
        "label": row.label,
        # Stored, so it survives a record being renamed and a route changing
        # shape for new records only.
        "url": row.url,
        "icon": row.icon,
        "position": row.position,
        "added_at": iso(row.created_at),
    }


def listing(session, *, principal) -> dict[str, Any]:
    """Every bookmark, in the order this person arranged them."""
    rows = session.scalars(
        select(Favorite)
        .where(Favorite.user_id == principal.user_id)
        .order_by(Favorite.position.asc(), Favorite.created_at.asc())
    ).all()

    listed = [_serialise(row) for row in rows]
    # Counted per type so the page can group them, and derived here rather
    # than in the browser so the number and the rows cannot disagree (§71).
    kinds: dict[str, int] = {}
    for item in listed:
        kinds[item["resource_type"]] = kinds.get(item["resource_type"], 0) + 1

    return {
        "items": listed,
        "total": len(listed),
        "maximum": MAX_FAVORITES,
        "kinds": [{"key": key, "count": kinds[key]} for key in sorted(kinds)],
        "bookmarkable": list(bookmarkable()),
    }


def add(session, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    """Bookmark something. The generic path, for anything with an address."""
    body = payload if isinstance(payload, dict) else {}
    resource_type = str(body.get("resource_type") or "").strip()
    resource_id = str(body.get("resource_id") or "").strip()
    label = str(body.get("label") or "").strip()
    url = str(body.get("url") or "").strip()

    if resource_type not in bookmarkable():
        raise ValidationError(
            "That is not something this platform can bookmark.",
            details={"resource_type": resource_type, "available": list(bookmarkable())},
        )
    if not resource_id or not label or not url:
        raise ValidationError(
            "A bookmark needs something to point at, a name and an address.",
            details={
                "missing": [
                    name
                    for name, value in (
                        ("resource_id", resource_id),
                        ("label", label),
                        ("url", url),
                    )
                    if not value
                ]
            },
        )
    if not url.startswith("/"):
        # An in-app route, never an absolute address: a "favourite" that
        # navigated off the platform would be a link nobody expects (§76).
        raise ValidationError(
            "A bookmark points at a page in this application.",
            details={"url": url},
        )

    set_favorite(
        session,
        principal,
        resource_type=resource_type,
        resource_id=resource_id,
        label=label,
        url=url,
        icon=str(body.get("icon") or ""),
        wanted=True,
    )
    audit.record(
        session,
        action="favorite.add",
        resource_type="favorite",
        resource_id=resource_id,
        resource_label=label,
        principal=principal,
        after={"resource_type": resource_type, "url": url},
        # One activity entry per bookmark would drown a feed in "starred a
        # ticket" (§48).
        activity=False,
    )
    session.commit()
    return listing(session, principal=principal)


def remove(session, ident: Any, *, principal) -> dict[str, Any]:
    """Unstar one thing."""
    row = session.get(Favorite, parse_uuid(ident, field="favorite id"))
    if row is None or row.user_id != principal.user_id:
        raise NotFoundError("That favourite does not exist.", details={"id": str(ident)})

    label = row.label
    resource_id = row.resource_id
    session.delete(row)
    session.flush()
    audit.record(
        session,
        action="favorite.remove",
        resource_type="favorite",
        resource_id=resource_id,
        resource_label=label,
        principal=principal,
        activity=False,
    )
    session.commit()
    return listing(session, principal=principal)


def arrange(session, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    """Put the bookmarks in the order somebody dragged them into.

    The whole list at once rather than a move-one call: a shortcut bar is
    rearranged by dragging, and applying that as a series of single moves is
    how two drags end up fighting over one position.
    """
    body = payload if isinstance(payload, dict) else {}
    order = body.get("order")
    if not isinstance(order, list) or not order:
        raise ValidationError("The order must be a list of favourite ids.")

    rows = {
        str(row.id): row
        for row in session.scalars(
            select(Favorite).where(Favorite.user_id == principal.user_id)
        )
    }
    unknown = [str(item) for item in order if str(item) not in rows]
    if unknown:
        # A stale list from a page that has not refreshed. Refused rather than
        # partially applied, because half an arrangement is worse than none.
        raise ValidationError(
            "Those favourites are not yours, or no longer exist.",
            details={"ids": unknown},
        )

    for position, item in enumerate(order, start=1):
        rows[str(item)].position = position
    # Anything the page did not mention keeps its place after the named ones,
    # so a partial list cannot silently reshuffle the rest.
    for row in rows.values():
        if str(row.id) not in {str(item) for item in order}:
            row.position = len(order) + row.position

    session.commit()
    return listing(session, principal=principal)


# ── recents ─────────────────────────────────────────────────────────────


def recents(session, *, principal) -> dict[str, Any]:
    """What this person has looked at lately, most recent first."""
    rows = session.scalars(
        select(RecentItem)
        .where(RecentItem.user_id == principal.user_id)
        .order_by(RecentItem.visited_at.desc())
        .limit(MAX_RECENTS)
    ).all()

    starred = {
        (row.resource_type, row.resource_id)
        for row in session.scalars(
            select(Favorite).where(Favorite.user_id == principal.user_id)
        )
    }

    return {
        "items": [
            {
                "id": str(row.id),
                "resource_type": row.resource_type,
                "resource_id": row.resource_id,
                "label": row.label,
                "url": row.url,
                "icon": row.icon,
                "visited_at": iso(row.visited_at),
                # "How often" is what separates a place somebody works from
                # one they wandered into once.
                "visit_count": row.visit_count,
                # So the page can offer "star this" on a recent without a
                # second request per row.
                "is_favorite": (row.resource_type, row.resource_id) in starred,
            }
            for row in rows
        ],
        "total": len(rows),
        "kept": MAX_RECENTS,
    }


def visit(session, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    """Record that this person looked at something.

    Upserted on `(user, type, id)` — the table's own unique constraint — so a
    place somebody works accumulates a visit count rather than fifty rows.
    Trimmed to `MAX_RECENTS`, because a recents list is a by-product and an
    unbounded by-product is a table that only grows.
    """
    body = payload if isinstance(payload, dict) else {}
    resource_type = str(body.get("resource_type") or "").strip()
    resource_id = str(body.get("resource_id") or "").strip()
    label = str(body.get("label") or "").strip()
    url = str(body.get("url") or "").strip()

    if not (resource_type and resource_id and label and url):
        raise ValidationError("A visit needs a type, an id, a name and an address.")

    row = session.scalar(
        select(RecentItem).where(
            RecentItem.user_id == principal.user_id,
            RecentItem.resource_type == resource_type,
            RecentItem.resource_id == resource_id,
        )
    )
    moment = now()
    if row is None:
        session.add(
            RecentItem(
                user_id=principal.user_id,
                resource_type=resource_type,
                resource_id=resource_id,
                label=label[:240],
                url=url[:500],
                icon=str(body.get("icon") or "") or None,
                visited_at=moment,
                visit_count=1,
            )
        )
    else:
        row.visited_at = moment
        row.visit_count += 1
        # Kept fresh, so a renamed record does not sit in the list under its
        # old name.
        row.label = label[:240] or row.label
        row.url = url[:500] or row.url

    session.flush()
    _trim_recents(session, principal)
    session.commit()
    return recents(session, principal=principal)


def _trim_recents(session, principal) -> None:
    """Keep the newest `MAX_RECENTS` and drop the rest."""
    keep = [
        row[0]
        for row in session.execute(
            select(RecentItem.id)
            .where(RecentItem.user_id == principal.user_id)
            .order_by(RecentItem.visited_at.desc())
            .limit(MAX_RECENTS)
        ).all()
    ]
    if not keep:
        return
    stale = session.scalars(
        select(RecentItem).where(
            RecentItem.user_id == principal.user_id, RecentItem.id.notin_(keep)
        )
    ).all()
    for row in stale:
        session.delete(row)
    if stale:
        session.flush()


def clear_recents(session, *, principal) -> dict[str, Any]:
    """Forget what this person has looked at.

    All of it or none: a recents list is a trail, and removing one entry from
    a trail leaves a misleading one. Bookmarks are untouched, because those
    were a decision rather than a by-product.
    """
    rows = session.scalars(
        select(RecentItem).where(RecentItem.user_id == principal.user_id)
    ).all()
    for row in rows:
        session.delete(row)

    if rows:
        audit.record(
            session,
            action="recents.clear",
            resource_type="recent",
            resource_id=principal.user_id,
            resource_label=f"{len(rows)} items",
            principal=principal,
            activity=False,
        )
    session.commit()
    return {"cleared": len(rows), **recents(session, principal=principal)}
