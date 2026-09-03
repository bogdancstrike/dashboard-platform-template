"""Saved searches, views, favorites, recents, dashboards, reports, preferences.

These are what make the platform feel like it remembers you, so the seed
concentrates them on the five realm personas: a reviewer signs in as `admin`
and finds a home dashboard, recent items, favourites and saved searches already
there. Spread evenly across 150 users, every one of those panels would be empty
on the account anybody actually opens.
"""

from __future__ import annotations

from src.core.query import Field, FieldSet
from src.core.rules import describe_tree, rule_count
from src.models.business import Task
from src.seed import catalog
from src.seed.support import slugify
from src.seed.world import World

SCOPES: tuple[tuple[str, float], ...] = (
    ("PRIVATE", 0.5), ("TEAM", 0.24), ("ORGANIZATION", 0.2), ("PUBLIC", 0.06),
)

#: Enough of a field set to render `condition_text` through the same code the
#: query inspector uses, rather than writing the description by hand.
_SPEC = FieldSet(
    Field("status", Task.status, kind="enum", label="Status"),
    Field("priority", Task.priority, kind="enum", label="Priority"),
    Field("due_date", Task.due_date, kind="datetime", label="Due date"),
    Field("title", Task.title, kind="text", label="Title", searchable=True),
)

COLUMN_SETS: dict[str, tuple[str, ...]] = {
    "task": ("reference", "title", "status", "priority", "assignee", "due_date"),
    "ticket": ("reference", "subject", "status", "severity", "customer", "due_at"),
    "project": ("code", "name", "status", "health", "owner", "progress", "due_date"),
    "customer": ("code", "name", "segment", "lifecycle_stage", "lifetime_value", "account_manager"),
    "order": ("reference", "customer", "status", "payment_status", "total", "placed_at"),
    "device": ("serial", "name", "kind", "status", "location", "last_seen_at"),
    "user": ("full_name", "email", "role", "department", "status", "last_login_at"),
    "file": ("name", "kind", "size_bytes", "owner", "created_at"),
}


def build(world: World) -> None:
    _notification_preferences(world)
    _saved_searches(world)
    _saved_views(world)
    _dashboards(world)
    _reports(world)
    _favorites(world)
    _recent_items(world)


def _audience(world: World):
    """Personas weighted heavily, everyone else present but thin."""
    return list(world.personas.values()) * 4 + world.users


def _condition_tree(rng) -> dict:
    return {
        "type": "group",
        "conjunction": rng.pick(("AND", "AND", "OR")),
        "children1": {
            "r1": {
                "type": "rule",
                "properties": {
                    "field": "status",
                    "operator": "select_not_any_in",
                    "value": [["DONE", "CANCELLED"]],
                },
            },
            "r2": {
                "type": "rule",
                "properties": {
                    "field": "priority",
                    "operator": "select_any_in",
                    "value": [["HIGH", "CRITICAL"]],
                },
            },
        },
    }


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


def _saved_searches(world: World) -> None:
    from src.models.personal import SavedSearch

    rng = world.rng.derive("saved-searches")
    audience = _audience(world)
    if not audience:
        return

    for index in range(world.scale.saved_searches):
        name, resource_type = catalog.SAVED_SEARCH_NAMES[index % len(catalog.SAVED_SEARCH_NAMES)]
        owner = rng.pick(audience)
        tree = _condition_tree(rng)
        columns = COLUMN_SETS.get(resource_type, ("name", "status"))

        world.saved_searches.append(
            SavedSearch(
                id=rng.uuid(),
                name=name if index < len(catalog.SAVED_SEARCH_NAMES) else f"{name} ({index // len(catalog.SAVED_SEARCH_NAMES) + 1})",
                description=rng.maybe(f"{name} — kept for the weekly review.", 0.5),
                resource_type=resource_type,
                owner_id=owner.id,
                organization_id=owner.organization_id,
                scope=rng.weighted(SCOPES),
                condition_tree=tree,
                # Rendered by the inspector's own function: the text a user
                # reads is then provably the shape of the SQL that runs.
                condition_text=describe_tree(tree, _SPEC),
                filters={"q": rng.maybe("overdue", 0.3)},
                query_text=rng.maybe("overdue", 0.3),
                sort=rng.pick(("created_at", "due_date", "priority")),
                order=rng.pick(("asc", "desc")),
                columns=list(columns),
                page_size=rng.pick((10, 25, 50, 100)),
                view_mode=rng.pick(("table", "table", "board", "cards")),
                is_favorite=rng.chance(0.35),
                is_default=index == 0,
                rule_count=rule_count(tree),
                use_count=rng.integer(0, 240),
                last_used_at=rng.maybe(rng.recent(days=30), 0.8),
                created_at=rng.ago(days_min=5, days_max=400),
            )
        )


def _saved_views(world: World) -> None:
    from src.models.personal import SavedView

    rng = world.rng.derive("saved-views")
    audience = _audience(world)
    if not audience:
        return

    for index in range(world.scale.saved_views):
        name, resource_type = catalog.SAVED_VIEW_NAMES[index % len(catalog.SAVED_VIEW_NAMES)]
        owner = rng.pick(audience)
        columns = list(COLUMN_SETS.get(resource_type, ("name", "status")))

        world.saved_views.append(
            SavedView(
                id=rng.uuid(),
                name=name if index < len(catalog.SAVED_VIEW_NAMES) else f"{name} ({index // len(catalog.SAVED_VIEW_NAMES) + 1})",
                description=rng.maybe("Layout used by the operations stand-up.", 0.45),
                resource_type=resource_type,
                owner_id=owner.id,
                organization_id=owner.organization_id,
                scope=rng.weighted(SCOPES),
                filters={"status": "ACTIVE"} if rng.chance(0.5) else {},
                columns=columns,
                column_widths={column: rng.integer(90, 320) for column in columns},
                pinned_columns=columns[:1],
                sort=rng.pick(columns),
                order=rng.pick(("asc", "desc")),
                group_by=rng.maybe(rng.pick(("status", "priority", "owner")), 0.35),
                page_size=rng.pick((25, 50, 100)),
                density=rng.pick(("compact", "middle", "comfortable")),
                view_mode=rng.pick(("table", "table", "board", "cards")),
                is_default=index % len(catalog.SAVED_VIEW_NAMES) == 0,
                use_count=rng.integer(0, 180),
                created_at=rng.ago(days_min=5, days_max=350),
            )
        )


def _dashboards(world: World) -> None:
    from src.models.personal import Dashboard, DashboardWidget

    rng = world.rng.derive("dashboards")
    audience = _audience(world)
    if not audience:
        return

    for index in range(world.scale.dashboards):
        owner = rng.pick(audience)
        name = rng.pick(
            ("Executive overview", "Operations", "My work", "Support desk",
             "Revenue", "Delivery health", "Field devices", "Security posture")
        )
        dashboard = Dashboard(
            id=rng.uuid(),
            name=name if index >= len(world.personas) else f"{name}",
            slug=slugify(f"{name}-{index}"),
            description=rng.maybe("Pinned to the sidebar for the daily review.", 0.5),
            owner_id=owner.id,
            organization_id=owner.organization_id,
            scope=rng.weighted(SCOPES),
            is_default=index == 0,
            is_home=index < len(world.personas),
            icon=rng.pick(("layout-dashboard", "activity", "bar-chart", "shield", "package")),
            filters={"period": rng.pick(("last_7_days", "last_30_days", "current_month", "current_year"))},
            columns=12,
            created_at=rng.ago(days_min=10, days_max=400),
        )
        world.dashboards.append(dashboard)

        # A 12-column grid, laid out left to right and wrapped — so the seeded
        # dashboards open as something readable rather than a pile.
        x = 0
        y = 0
        for position, (kind, title, entity) in enumerate(
            rng.sample(catalog.DASHBOARD_WIDGETS, rng.integer(4, 8))
        ):
            width = 3 if kind == "KPI" else rng.pick((4, 6, 6, 12))
            height = 1 if kind == "KPI" else rng.pick((2, 2, 3))
            if x + width > 12:
                x = 0
                y += height
            world.dashboard_widgets.append(
                DashboardWidget(
                    id=rng.uuid(),
                    dashboard_id=dashboard.id,
                    kind=kind,
                    title=title,
                    subtitle=rng.maybe("vs previous period", 0.5),
                    x=x,
                    y=y,
                    width=width,
                    height=height,
                    position=position,
                    config={
                        "entity": entity,
                        "metric": rng.pick(("count", "sum", "avg")),
                        "period": rng.pick(("last_7_days", "last_30_days", "current_month")),
                        "chart": kind.lower(),
                        "filters": {},
                    },
                    created_at=dashboard.created_at,
                )
            )
            x += width


def _reports(world: World) -> None:
    from src.models.personal import Report

    rng = world.rng.derive("reports")
    audience = _audience(world)
    if not audience:
        return

    for index in range(world.scale.reports):
        name, resource_type, visualization = catalog.REPORT_NAMES[index % len(catalog.REPORT_NAMES)]
        owner = rng.pick(audience)
        world.reports.append(
            Report(
                id=rng.uuid(),
                name=name if index < len(catalog.REPORT_NAMES) else f"{name} ({index // len(catalog.REPORT_NAMES) + 1})",
                description=rng.maybe("Distributed to the leadership list each Monday.", 0.4),
                resource_type=resource_type,
                owner_id=owner.id,
                organization_id=owner.organization_id,
                scope=rng.weighted(SCOPES),
                dimensions=rng.sample(("region", "status", "owner", "month", "segment", "channel"), rng.integer(1, 3)),
                metrics=rng.sample(("count", "total", "average", "median", "sum"), rng.integer(1, 2)),
                filters={"period": "last_30_days"},
                group_by=rng.pick(("region", "status", "month")),
                sort=rng.pick(("total", "count")),
                order="desc",
                period=rng.pick(("last_7_days", "last_30_days", "last_90_days", "current_year")),
                visualization=visualization,
                is_favorite=rng.chance(0.3),
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

    while len(world.favorites) < world.scale.favorites and attempts < world.scale.favorites * 6:
        attempts += 1
        user = rng.pick(audience)
        resource_type, resource_id, label, url, icon = rng.pick(targets)
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
