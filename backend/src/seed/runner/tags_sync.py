"""Repairing tags and favourites."""

from __future__ import annotations


def sync_tags(session) -> dict[str, int]:
    """Make each record's `tags` array agree with its links (§37).

    There were two stores for one fact, and nothing kept them in step: 44 tasks
    carried a `tags` array and 28 had `tag_links` rows, with no reason to think
    the two sets agreed. The same shape as the favourites defect, found the
    same way — by building the page that reads the data.

    `services/tags` now treats the *links* as the truth and the array as a
    derived cache with one writer. This is the repair that brings an existing
    database up to that: it rewrites the array of every record that has links,
    and *clears* it on every record that has an array and no links — because a
    string left behind after the link went is exactly the stale value the
    single-writer rule exists to prevent.

    Idempotent: a record already in step is written the same value.
    """
    from sqlalchemy import func
    from sqlalchemy import select as _select

    from src.models.content import Tag, TagLink
    from src.services.records.explorer import resources as _resources
    from src.services.records.tags import _resync

    rewritten = 0
    cleared = 0
    recounted = 0

    # Every record that has at least one link, by dataset.
    linked: dict[str, set[str]] = {}
    for resource_type, resource_id in session.execute(
        _select(TagLink.resource_type, TagLink.resource_id).distinct()
    ).all():
        linked.setdefault(str(resource_type), set()).add(str(resource_id))

    catalogue = _resources()
    for resource_type, ids in linked.items():
        if resource_type not in catalogue:
            continue
        for resource_id in ids:
            _resync(session, resource_type, resource_id)
            rewritten += 1

    # And the other direction: an array with no links behind it.
    for key, resource in catalogue.items():
        model = resource.model
        if not hasattr(model, "tags"):
            continue
        rows = session.scalars(
            _select(model).where(model.tags.isnot(None))
        ).unique().all()
        for row in rows:
            if str(row.id) in linked.get(key, set()):
                continue
            if row.tags:
                row.tags = None
                cleared += 1

    # The usage counts are the third derived value here, and the manager sorts
    # by them — a count that drifted would put the wrong tags at the top.
    for tag in session.scalars(_select(Tag)).all():
        wanted = int(
            session.scalar(
                _select(func.count()).select_from(TagLink).where(TagLink.tag_id == tag.id)
            )
            or 0
        )
        if tag.usage_count != wanted:
            tag.usage_count = wanted
            recounted += 1

    session.flush()
    return {"rewritten": rewritten, "cleared": cleared, "recounted": recounted}


def sync_favorites(session) -> dict[str, int]:
    """Move the old per-row `is_favorite` flags into the one store (§38).

    There were two stores for one fact. `favorites` is a table whose docstring
    reads "a bookmark on anything addressable" and which had no service at
    all, while `Report.is_favorite` and `SavedSearch.is_favorite` were boolean
    columns — and the saved-search drawer's own tooltip said "Add to
    favourites" while writing the column, so a reader could star a search, be
    told it went to their favourites, and find nothing there.

    This copies each flagged row into a `Favorite` and then *clears the
    column*, so `is_favorite = false` everywhere is the steady state and
    `--check` can assert exactly that. Keeping the columns in sync would be
    maintaining the second store the change exists to remove.

    Idempotent: a flag already migrated is already false, and a `Favorite`
    that exists is left alone.
    """
    from sqlalchemy import func as _func
    from sqlalchemy import select as _select

    from src.models.personal import Favorite, Report, SavedSearch

    moved = 0
    already = 0

    def _carry(row, *, resource_type: str, url: str, icon: str) -> None:
        nonlocal moved, already
        existing = session.scalar(
            _select(Favorite).where(
                Favorite.user_id == row.owner_id,
                Favorite.resource_type == resource_type,
                Favorite.resource_id == str(row.id),
            )
        )
        if existing is None:
            highest = session.scalar(
                _select(_func.max(Favorite.position)).where(Favorite.user_id == row.owner_id)
            )
            session.add(
                Favorite(
                    user_id=row.owner_id,
                    resource_type=resource_type,
                    resource_id=str(row.id),
                    label=(row.name or resource_type)[:240],
                    url=url,
                    icon=icon,
                    position=int(highest or 0) + 1,
                    # The star was made when the row was last touched, which is
                    # the closest true answer available.
                    created_at=row.updated_at or row.created_at,
                )
            )
            moved += 1
        else:
            already += 1
        # Cleared either way: the column is no longer where the answer lives.
        row.is_favorite = False

    for report in session.scalars(
        _select(Report).where(Report.is_favorite.is_(True), Report.owner_id.is_not(None))
    ):
        _carry(report, resource_type="report", url=f"/reports/{report.id}", icon="bar-chart")

    for search in session.scalars(
        _select(SavedSearch).where(
            SavedSearch.is_favorite.is_(True), SavedSearch.owner_id.is_not(None)
        )
    ):
        _carry(
            search,
            resource_type="saved_search",
            url=f"/search/saved/{search.id}",
            icon="search",
        )

    session.flush()
    return {"moved": moved, "already_bookmarked": already}
