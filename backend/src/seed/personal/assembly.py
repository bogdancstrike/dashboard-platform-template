"""Seed data for personal: build."""

from __future__ import annotations

from src.seed import catalog
from src.seed.personal.dashboards import _dashboards
from src.seed.personal.kanban import _kanban
from src.seed.personal.reports import (
    _bookmarkable,
    _favorites,
    _notification_preferences,
    _reports,
)
from src.seed.personal.saved_searches import COLUMN_SETS, _audience, _saved_searches
from src.seed.personal.shares import _shares
from src.seed.world import World


def build(world: World) -> None:
    _notification_preferences(world)
    _saved_searches(world)
    _list_views(world)
    _shares(world)
    _dashboards(world)
    _reports(world)
    _favorites(world)
    _recent_items(world)
    _kanban(world)


def _list_views(world: World) -> None:
    """One public saved view per dataset, of the kind a list's filter bar saves.

    Owned by the personas in turn and public, for the reason the dashboards
    below are dealt out that way: a feature that can only be seen by somebody
    who first creates the data is a feature nobody reviewing the demo sees.
    Public also demonstrates the half of §5 that matters here — a colleague can
    *apply* a shared view and cannot change it.

    Distinct from the searches above, which carry condition trees: a tree
    cannot be drawn as a row of facet selects, so those are offered on a list
    as links to the Data Explorer and these are the ones a list can show (§46).
    """
    from src.models.personal import SavedSearch

    rng = world.rng.derive("list-views")
    personas = list(world.personas.values())
    if not personas:
        return

    for index, (name, resource_type, field, value) in enumerate(catalog.LIST_VIEWS):
        owner = personas[index % len(personas)]
        world.saved_searches.append(
            SavedSearch(
                id=rng.uuid(),
                name=name,
                description=f"Saved from the {resource_type} list.",
                resource_type=resource_type,
                owner_id=owner.id,
                organization_id=owner.organization_id,
                scope="PUBLIC",
                # No tree, which is what makes it applicable to a list.
                condition_tree=None,
                condition_text=None,
                filters={field: value},
                query_text=None,
                sort=rng.pick(("created_at", "updated_at")),
                order="desc",
                columns=list(COLUMN_SETS.get(resource_type, ("name", "status"))),
                page_size=25,
                view_mode="table",
                is_default=False,
                rule_count=0,
                use_count=rng.integer(0, 120),
                last_used_at=rng.maybe(rng.recent(days=21), 0.7),
                created_at=rng.ago(days_min=5, days_max=200),
            )
        )


def _recent_items(world: World) -> None:
    from src.models.personal import RecentItem

    rng = world.rng.derive("recents")
    audience = _audience(world)
    targets = _bookmarkable(world)
    if not audience or not targets:
        return

    seen: set[tuple] = set()
    attempts = 0

    while len(world.recent_items) < world.scale.recent_items and attempts < world.scale.recent_items * 6:
        attempts += 1
        user = rng.pick(audience)
        resource_type, resource_id, label, url, icon = rng.pick(targets)
        key = (user.id, resource_type, str(resource_id))
        if key in seen:
            continue
        seen.add(key)
        world.recent_items.append(
            RecentItem(
                id=rng.uuid(),
                user_id=user.id,
                resource_type=resource_type,
                resource_id=str(resource_id),
                label=label[:240],
                url=url,
                icon=icon,
                # Weighted towards now, so "recent" is populated at the top and
                # thins out — which is what a real history looks like.
                visited_at=rng.recent(days=30, bias=3.0),
                visit_count=rng.weighted(((1, 0.5), (2, 0.2), (rng.integer(3, 9), 0.2), (rng.integer(10, 60), 0.1))),
                created_at=rng.recent(days=60),
            )
        )
