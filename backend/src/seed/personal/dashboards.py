"""Seed data for personal: _dashboards, _analysable."""

from __future__ import annotations

from src.seed import catalog
from src.seed.personal.saved_searches import SCOPES, _audience
from src.seed.support import slugify
from src.seed.world import World


def _dashboards(world: World) -> None:
    from src.models.personal import Dashboard, DashboardWidget

    rng = world.rng.derive("dashboards")
    audience = _audience(world)
    if not audience:
        return

    # The five personas get the first five dashboards, one each, in order —
    # rather than owners drawn at random. §67 is "one dashboard is *your* home
    # page", and it cannot be demonstrated by signing in as somebody who owns
    # none: the page correctly falls back to a colleague's public one, which is
    # right behaviour and a poor demonstration.
    personas = list(world.personas.values())

    for index in range(world.scale.dashboards):
        owner = personas[index] if index < len(personas) else rng.pick(audience)
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
            # Exactly one per persona, which is what the service enforces on
            # write and what the page shows in the list.
            is_home=index < len(personas),
            icon=rng.pick(("layout-dashboard", "activity", "bar-chart", "shield", "package")),
            filters={"period": rng.pick(("last_7_days", "last_30_days", "current_month", "current_year"))},
            columns=12,
            created_at=rng.ago(days_min=10, days_max=400),
        )
        world.dashboards.append(dashboard)

        # A 12-column grid, laid out left to right and wrapped — so the seeded
        # dashboards open as something readable rather than a pile.
        #
        # The row advances by the *tallest* widget in it, not by the last one
        # placed. Advancing by the last one produced overlapping rows: a
        # full-width panel three rows tall followed by a row of tiles put the
        # tiles inside it, and the grid then had to push them out — which is
        # what left the seeded dashboards full of holes.
        x = 0
        y = 0
        row_height = 0
        for position, (kind, title, entity) in enumerate(
            rng.sample(catalog.DASHBOARD_WIDGETS, rng.integer(4, 8))
        ):
            width = 3 if kind == "KPI" else rng.pick((4, 6, 6, 12))
            height = 1 if kind == "KPI" else rng.pick((2, 2, 3))
            if x + width > 12:
                x = 0
                y += row_height
                row_height = 0
            row_height = max(row_height, height)
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


def _analysable(resource_type: str) -> tuple[list[str], list[str]]:
    """Which columns of a dataset can be grouped by, and which can be measured.

    Read from the `Resource` declarations, using the very kinds the analysis
    compiler uses to decide the same thing — not typed out here. The reason is
    concrete: this seed used to draw dimensions from a literal
    ``("region", "status", "owner", "month", "segment", "channel")`` and
    measures from ``("count", "total", "average", "median", "sum")``. Not one
    dataset declares `region`, `owner` or `month`; `total`, `average` and
    `median` are not aggregations the compiler knows. So *every* seeded report
    named a column or a function that does not exist, and every one of them
    failed the moment somebody opened `/reports` — which is exactly what a
    reviewer does first.

    A seed that invents identifiers is a seed that ships broken rows. Derived,
    it cannot: a field renamed in the declaration is renamed here too.
    """
    from src.services.analytics.analysis import DIMENSION_KINDS, MEASURE_KINDS
    from src.services.records.explorer import resources

    resource = resources().get(resource_type)
    if resource is None:
        return [], []

    dimensions = [
        field.name
        for field in resource.fields.fields
        # `datetime` is excluded although the compiler groups by it: a date
        # needs a granularity to be a series, and a bare date column groups
        # into one row per timestamp, which is a list rather than an analysis.
        if field.kind in DIMENSION_KINDS and field.filterable and field.kind != "datetime"
    ]
    measures = [field.name for field in resource.fields.fields if field.kind in MEASURE_KINDS]
    return dimensions, measures
