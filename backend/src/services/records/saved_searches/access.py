"""Saved-search vocabulary, who sees which, and the sole default."""

from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from src.core import sharing
from src.core.pagination import parse_uuid
from src.core.repository import found_or_404
from src.models.personal import SavedSearch
from src.services.records.saved_searches.serializers import KIND

VIEW_MODES = frozenset({"table", "list", "cards", "compact"})


ORDERS = frozenset({"asc", "desc"})


#: Holding this is what separates "I keep my own searches" from "I decide what
#: other people see". OPERATOR and VIEWER have their own searches and no way to
#: publish one.
SHARE_PERMISSION = "searches.share"


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
    row = found_or_404(
        session.scalars(_visible_statement(principal).where(SavedSearch.id == identifier)).unique().one_or_none(),
        "The saved search does not exist or is private.",
    )
    return row


def _owned_visible(session, search_id: Any, principal) -> SavedSearch:
    row = _visible(session, search_id, principal)
    sharing.require_owner(row, principal, kind="saved search")
    return row
