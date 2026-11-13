"""`/admin/health` history: windows, thinning a long series, and incidents.

A month of readings is far more points than a chart can draw, so the series is
thinned to `MAX_POINTS` buckets keeping the *worst* status in each (an outage
must not be averaged away); consecutive non-healthy points collapse into one
incident; a malformed window falls back to the default rather than refusing —
the page is used during the incident it exists for.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

from src.core.clock import iso
from src.services import health


def test_a_window_is_a_named_period_or_a_pair_of_moments():
    period, since, until = health._window({"period": "7d"})
    assert period == "7d" and (until - since) == timedelta(hours=health.PERIODS["7d"])
    assert health._window({"period": "forever"})[0] == "1d"
    custom = health._window({"from": "2027-01-01T00:00:00", "to": "2027-01-02T00:00:00Z"})
    assert custom[0] == "custom" and custom[1] == datetime(2027, 1, 1, tzinfo=UTC)
    # Backwards or unreadable: the default, not a 400.
    assert health._window({"from": "2027-01-02", "to": "2027-01-01"})[0] == "1d"
    assert health._window({"from": "yesterday"})[0] == "1d"
    assert health._moment("") is None and health._moment("garbage") is None


def test_a_long_series_is_thinned_keeping_the_worst_and_outages_become_incidents():
    until = datetime(2027, 3, 1, tzinfo=UTC)
    since = until - timedelta(days=2)
    history = []
    for minute in range(0, 2 * 24 * 60, 5):  # 576 readings, more than MAX_POINTS
        at = since + timedelta(minutes=minute)
        status = "UNAVAILABLE" if 600 <= minute < 640 else ("DEGRADED" if 900 <= minute < 905 else "HEALTHY")
        history.append({"at": iso(at), "status": status, "latency_ms": 10})
    history += [{"at": "not a time"}, {"at": iso(since - timedelta(days=1)), "status": "HEALTHY"}]
    row = SimpleNamespace(key="db", name="Database", category="core", status="HEALTHY", latency_ms=3,
                          uptime_percent=99.9, message=None, last_checked_at=until, history=history)

    answer = health._service_history(row, since, until)
    assert len(answer["series"]) <= health.MAX_POINTS
    statuses = [point["status"] for point in answer["series"]]
    assert "UNAVAILABLE" in statuses and "DEGRADED" in statuses  # never averaged away
    kinds = [incident["status"] for incident in answer["incidents"]]
    assert kinds == ["UNAVAILABLE", "DEGRADED"]
    assert answer["incidents"][0]["points"] >= 2
    assert 0 < answer["window_uptime_percent"] < 100
    assert health._uptime([]) == 0.0
    assert health._bucket([], since, until) == []
