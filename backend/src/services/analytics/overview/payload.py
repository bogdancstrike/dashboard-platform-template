"""The whole overview payload, cached per period."""

from __future__ import annotations

from typing import Any

from src.core import cache
from src.core.clock import iso, now, previous_period, resolve_range
from src.services.analytics.overview.alerting import alerts
from src.services.analytics.overview.chart_panels import charts
from src.services.analytics.overview.feed import recent_activity
from src.services.analytics.overview.headline import kpis
from src.services.analytics.overview.measures import PERIODS

#: What the overview summarises, and therefore what makes it stale.
#:
#: Declared rather than inferred from the SQL below, because a reader can check
#: a declaration. Getting it wrong in one direction serves a stale number; in
#: the other it throws away an entry that was still good — and the first of
#: those is the one that matters, so this errs wide: the alert strip reads
#: background jobs and service health, and the feed reads the activity trail.
SUMMARISES = (
    "project",
    "customer",
    "ticket",
    "order",
    "task",
    "device",
    "activity",
    "job",
)


def summary(session, *, period: str, frm: str | None = None, to: str | None = None) -> dict[str, Any]:
    """The whole overview for one period, cached until something changes it.

    Twenty-odd aggregates over the whole dataset for a screen people open first
    thing every morning and then leave open. Cached on the *period* and on the
    generation of every dataset it summarises, so a write anywhere in the
    business makes the next read recompute — which is the only kind of cache
    this page can have. Behind a timer it would tell somebody who has just
    closed a ticket that it is still open, and the number they are checking is
    precisely the one they changed.
    """
    return cache.aggregate(
        "dashboard:summary",
        {"period": period or "last_30_days", "from": frm or "", "to": to or ""},
        depends_on=SUMMARISES,
        producer=lambda: _summary(session, period=period, frm=frm, to=to),
    )


def _summary(session, *, period: str, frm: str | None, to: str | None) -> dict[str, Any]:
    start, end = resolve_range(period, frm, to)
    prior_start, prior_end = previous_period(start, end)

    return {
        "period": {
            "key": period or "last_30_days",
            "from": iso(start),
            "to": iso(end),
            "previous_from": iso(prior_start),
            "previous_to": iso(prior_end),
            "options": [{"key": key, "label": label} for key, label in PERIODS],
        },
        "kpis": kpis(session, start, end),
        "charts": charts(session, start, end),
        "alerts": alerts(session),
        "activity": recent_activity(session),
        "generated_at": iso(now()),
    }
