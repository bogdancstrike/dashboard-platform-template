"""Repair dashboards and widgets whose period the analysis engine rejects.

The dashboard's period picker offered calendar periods ("This month") that the
analysis engine did not know, so seeded widgets drew as errors. The engine now
resolves those too; what is left for this repair is anything *neither* knows —
a key from an older picker, a typo saved through the API — which it resets to
the dashboard default rather than leave a widget that cannot draw.
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm.attributes import flag_modified

from src.models.personal import Dashboard, DashboardWidget
from src.services.analytics.analysis import known_period

#: What an unreadable period becomes: the dashboard's own default.
FALLBACK = "last_30_days"


def sync(session) -> dict[str, int]:
    dashboards = 0
    for dashboard in session.scalars(select(Dashboard)):
        filters = dict(dashboard.filters or {})
        if not known_period(filters.get("period")):
            filters["period"] = FALLBACK
            dashboard.filters = filters
            flag_modified(dashboard, "filters")
            dashboards += 1
    widgets = 0
    for widget in session.scalars(select(DashboardWidget)):
        config = dict(widget.config or {})
        if not known_period(config.get("period")):
            # Removed rather than replaced: a widget without its own period
            # follows its dashboard's, which is what the seed meant.
            config.pop("period", None)
            widget.config = config
            flag_modified(widget, "config")
            widgets += 1
    return {"dashboards": dashboards, "widgets": widgets}
