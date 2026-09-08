"""Bookmarks and recents (§38, §39).

**No permission, and that is the design.** These are your own bookmarks and
your own trail, and being signed in is the qualification — the same argument
`/settings/security` makes. `@requires()` with no arguments is
authenticated-only.

Seven operations, and the split between them is the point: **collection**,
**add**, **remove** and **arrange** are the *deliberate* list, and **recents**,
**visit** and **clear** are the automatic one. Mixing them would make the list
somebody chose indistinguishable from the list that happened.

There is no "update a bookmark". A bookmark's label and address are copies of
what was starred, refreshed the next time it is starred, and a rename typed
here would be a second name for the same thing. What *can* be changed is the
order, because that is the only part of a bookmark somebody decides.
"""

from __future__ import annotations

from typing import Any

from src.core.auth import json_body, me, requires
from src.core.db import session_scope
from src.services import favorites as service


@requires()
def collection(app=None, operation: str = "", request=None, **_: Any):
    """Every bookmark, in the order this person arranged them.

    Not sorted by name or date: a shortcut bar's order is a decision the reader
    made, and re-sorting it would throw that away.
    """
    with session_scope() as session:
        return service.listing(session, principal=me()), 200


@requires()
def add(app=None, operation: str = "", request=None, **_: Any):
    """Bookmark something addressable.

    The type is checked against the platform's own registry rather than a list
    of strings, and the address must be an in-app route — a "favourite" that
    navigated off the platform would be a link nobody expects (§76).
    """
    with session_scope() as session:
        return service.add(session, json_body(), principal=me()), 201


@requires()
def item(app=None, operation: str = "", request=None, favorite_id: str = "", **kwargs: Any):
    """Unstar one thing. Answers with the list, because that is what changed."""
    identifier = favorite_id or str(kwargs.get("favorite_id") or "")
    with session_scope() as session:
        return service.remove(session, identifier, principal=me()), 200


@requires()
def arrange(app=None, operation: str = "", request=None, **_: Any):
    """Put the bookmarks in the order somebody dragged them into.

    The whole list at once rather than a move-one call: a shortcut bar is
    rearranged by dragging, and applying that as a series of single moves is
    how two drags end up fighting over one position.
    """
    with session_scope() as session:
        return service.arrange(session, json_body(), principal=me()), 200


@requires()
def recents(app=None, operation: str = "", request=None, **_: Any):
    """What this person has looked at lately, most recent first.

    Each row carries `is_favorite`, so the page can offer "star this" without
    a request per row.
    """
    with session_scope() as session:
        return service.recents(session, principal=me()), 200


@requires()
def visit(app=None, operation: str = "", request=None, **_: Any):
    """Record that this person looked at something.

    Upserted on `(user, type, id)` — the table's own unique constraint — so a
    place somebody works accumulates a visit count rather than fifty rows, and
    trimmed, because an unbounded by-product is a table that only grows.
    """
    with session_scope() as session:
        return service.visit(session, json_body(), principal=me()), 200


@requires()
def clear_recents(app=None, operation: str = "", request=None, **_: Any):
    """Forget the trail. All of it or none.

    Removing one entry from a trail leaves a misleading one. Bookmarks are
    untouched, because those were a decision rather than a by-product.
    """
    with session_scope() as session:
        return service.clear_recents(session, principal=me()), 200
