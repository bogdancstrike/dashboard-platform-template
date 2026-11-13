"""Seed data for personal: _reports, _bookmarkable, _favorites."""

from __future__ import annotations

from src.seed import catalog
from src.seed.personal.dashboards import _analysable
from src.seed.personal.saved_searches import SCOPES, _audience
from src.seed.world import World


def _notification_preferences(world: World) -> None:
    from src.models.personal import NotificationPreference

    rng = world.rng.derive("notification-prefs")
    for user in world.users:
        for category in catalog.NOTIFICATION_CATEGORIES:
            world.notification_preferences.append(
                NotificationPreference(
                    id=rng.uuid(),
                    user_id=user.id,
                    category=category,
                    in_app=rng.chance(0.92),
                    # Security notices default to email regardless of taste —
                    # the one category nobody should be able to silence quietly.
                    email=True if category == "SECURITY" else rng.chance(0.4),
                    push=rng.chance(0.18),
                    digest=rng.weighted((("INSTANT", 0.6), ("DAILY", 0.28), ("WEEKLY", 0.12))),
                    quiet_hours_start=rng.maybe("22:00", 0.35),
                    quiet_hours_end=rng.maybe("07:00", 0.35),
                    created_at=user.created_at,
                )
            )


def _reports(world: World) -> None:
    from src.models.personal import Report

    rng = world.rng.derive("reports")
    audience = _audience(world)
    if not audience:
        return

    for index in range(world.scale.reports):
        name, resource_type, visualization = catalog.REPORT_NAMES[index % len(catalog.REPORT_NAMES)]
        owner = rng.pick(audience)
        groupable, measurable = _analysable(resource_type)
        if not groupable:
            # A dataset nothing can be grouped by cannot hold a report. Better
            # one report fewer than one that answers an error.
            continue

        # At most two: the compiler refuses a third, and a report stored with
        # three is a saved question nobody can ever run.
        dimensions = rng.sample(tuple(groupable), min(rng.integer(1, 2), len(groupable)))
        # `count` always works; a column measure needs a numeric column, and
        # the stored form is `aggregation:field` (`services/reports`).
        metrics = ["count"]
        if measurable and rng.chance(0.6):
            metrics = [f"{rng.pick(('sum', 'avg', 'max'))}:{rng.pick(tuple(measurable))}"]

        world.reports.append(
            Report(
                id=rng.uuid(),
                name=name if index < len(catalog.REPORT_NAMES) else f"{name} ({index // len(catalog.REPORT_NAMES) + 1})",
                description=rng.maybe("Distributed to the leadership list each Monday.", 0.4),
                resource_type=resource_type,
                owner_id=owner.id,
                organization_id=owner.organization_id,
                scope=rng.weighted(SCOPES),
                dimensions=dimensions,
                metrics=metrics,
                filters={"period": "last_30_days"},
                # The first grouping, not a third name: `group_by` that names
                # a column the dimensions do not is a fourth opinion about the
                # same question.
                group_by=dimensions[0],
                sort=metrics[0].partition(":")[0],
                order="desc",
                period=rng.pick(("last_7_days", "last_30_days", "last_90_days", "current_year")),
                visualization=visualization,
                # Not `is_favorite` — see the saved-search generator above.
                last_run_at=rng.maybe(rng.recent(days=14), 0.8),
                run_count=rng.integer(0, 500),
                schedule=rng.maybe(rng.pick(("0 7 * * 1", "0 6 1 * *", "0 8 * * *")), 0.3),
                created_at=rng.ago(days_min=10, days_max=500),
            )
        )


def _favorites(world: World) -> None:
    from src.models.personal import Favorite

    rng = world.rng.derive("favorites")
    audience = _audience(world)
    targets = _bookmarkable(world)
    if not audience or not targets:
        return

    # (user, resource_type, resource_id) is unique, so pairs are tracked.
    seen: set[tuple] = set()
    attempts = 0
    positions: dict = {}

    # Grouped by kind and drawn round-robin, so a bookmark list demonstrates
    # *several* kinds. A flat uniform draw is dominated by whatever the seed
    # made most of — tasks and tickets — and would leave the page showing
    # eleven tickets and nothing else, which demonstrates a list rather than a
    # shortcut bar. Reports and saved searches in particular are the two the
    # old design could not put here at all (§38).
    by_kind: dict[str, list] = {}
    for target in targets:
        by_kind.setdefault(target[0], []).append(target)
    kinds = sorted(by_kind)

    while len(world.favorites) < world.scale.favorites and attempts < world.scale.favorites * 6:
        attempts += 1
        user = rng.pick(audience)
        kind = kinds[attempts % len(kinds)]
        resource_type, resource_id, label, url, icon = rng.pick(by_kind[kind])
        key = (user.id, resource_type, str(resource_id))
        if key in seen:
            continue
        seen.add(key)
        position = positions.get(user.id, 0)
        positions[user.id] = position + 1
        world.favorites.append(
            Favorite(
                id=rng.uuid(),
                user_id=user.id,
                resource_type=resource_type,
                resource_id=str(resource_id),
                label=label[:240],
                url=url,
                icon=icon,
                position=position,
                created_at=rng.recent(days=180),
            )
        )


def _bookmarkable(world: World) -> list[tuple[str, object, str, str, str]]:
    """Everything a user can pin or revisit, with the route that opens it."""
    out: list[tuple[str, object, str, str, str]] = []
    for project in world.projects:
        out.append(("project", project.id, project.name, f"/projects/{project.id}", "folder"))
    for task in world.tasks:
        out.append(("task", task.id, task.title, f"/tasks/{task.id}", "check-square"))
    for ticket in world.tickets:
        out.append(("ticket", ticket.id, ticket.subject, f"/tickets/{ticket.id}", "life-buoy"))
    for customer in world.customers:
        out.append(("customer", customer.id, customer.name, f"/customers/{customer.id}", "building"))
    for order in world.orders:
        out.append(("order", order.id, order.reference, f"/orders/{order.id}", "shopping-cart"))
    for report in world.reports:
        out.append(("report", report.id, report.name, f"/reports/{report.id}", "bar-chart"))
    for search in world.saved_searches:
        out.append(("saved_search", search.id, search.name, f"/search/saved/{search.id}", "search"))
    return out
