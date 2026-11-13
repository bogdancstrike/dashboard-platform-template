"""The periods a dashboard offers are periods the analysis engine reads.

The dashboard's picker offers calendar periods ("This month") beside rolling
ones, and seeded widgets were saved with them — which the engine refused, so
those widgets drew as errors on the signed-in dashboard.
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from src.core.clock import resolve_range
from src.services import analysis
from src.services.dashboard import PERIODS as DASHBOARD_PERIODS


@pytest.mark.parametrize("key", [key for key, _ in DASHBOARD_PERIODS if key != "custom"])
def test_every_period_the_dashboard_offers_resolves(key):
    window = analysis.period_window(key)
    assert window.key == key
    assert window.start is not None and window.end is not None
    assert window.start <= window.end


def test_this_month_means_what_the_kpi_header_means():
    window = analysis.period_window("current_month")
    assert (window.start, window.end.date()) == (resolve_range("current_month")[0], resolve_range("current_month")[1].date())
    assert window.start.day == 1


def test_calendar_periods_are_named_and_listed():
    assert analysis._period_label("current_month") == "This month"
    keys = {key for key in analysis.PERIODS} | set(analysis.CALENDAR_PERIODS)
    assert {"current_month", "current_year", "last_30_days"} <= keys
    assert analysis._calendar_days("current_year") >= 1


def test_known_period():
    for value in (None, "", "all_time", "current_month", "last_7_days", {"from": "2026-01-01"}):
        assert analysis.known_period(value)
    assert not analysis.known_period("since_tuesday")


def test_the_unknown_period_error_lists_the_calendar_ones_too():
    from src.core.errors import ValidationError

    with pytest.raises(ValidationError) as raised:
        analysis.period_window("since_tuesday")
    assert "current_month" in raised.value.details["allowed"]


def test_the_repair_resets_only_what_cannot_be_read(monkeypatch):
    from src.seed import dashboard_periods

    good = SimpleNamespace(filters={"period": "current_month"})
    bad = SimpleNamespace(filters={"period": "fortnight"})
    empty = SimpleNamespace(filters=None)
    keep = SimpleNamespace(config={"entity": "order", "period": "last_7_days"})
    drop = SimpleNamespace(config={"entity": "order", "period": "since_tuesday"})

    class Session:
        def scalars(self, statement):
            return [good, bad, empty] if "dashboard_widgets" not in str(statement) else [keep, drop]

    # Plain objects carry no SQLAlchemy state to flag.
    monkeypatch.setattr(dashboard_periods, "flag_modified", lambda *_: None)
    assert dashboard_periods.sync(Session()) == {"dashboards": 1, "widgets": 1}
    assert bad.filters["period"] == "last_30_days"
    assert good.filters["period"] == "current_month"
    assert "period" not in drop.config and drop.config["entity"] == "order"
    assert keep.config["period"] == "last_7_days"
