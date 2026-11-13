"""The Records & analytics seed (`--sync-analytics`): fills an empty database, then adds nothing.

Run inside one transaction that is rolled back, so the demo database keeps its
own seeded rows: the tables are emptied *in the transaction*, the seed runs,
and nothing of it survives the test.
"""

from __future__ import annotations

import pytest
from sqlalchemy import func, select, text

pytestmark = pytest.mark.database


def test_the_seed_fills_every_feature_and_is_idempotent():
    from src.core.db import new_session
    from src.models.platform import AuditLog
    from src.models.records_analytics import (
        Contract, CustomerHealth, CustomerHealthSnapshot, DashboardLink, MetricAnomaly, MetricWatch,
    )
    from src.seed import records_analytics as seed

    session = new_session()
    try:
        session.execute(text("DELETE FROM metric_anomalies; DELETE FROM metric_watches; DELETE FROM dashboard_links; "
                             "DELETE FROM contracts; DELETE FROM customer_health_snapshots; "
                             "DELETE FROM notifications WHERE group_key LIKE 'health:%'"))
        session.query(AuditLog).filter(AuditLog.metadata_json["source"].astext == seed.MARK["source"]).delete(
            synchronize_session=False)
        session.flush()

        counts = seed.populate(session)
        assert counts["contracts"] > 10
        assert counts["health_scores"] > 10
        assert counts["health_snapshots"] == counts["health_scores"] * 90
        assert counts["version_histories"] >= 6
        assert counts["metric_watches"] == len(seed.WATCHES)
        assert counts["public_links"] == 2

        stages = dict(session.execute(select(Contract.stage, func.count()).group_by(Contract.stage)).all())
        assert set(stages) <= {"UPCOMING", "NEGOTIATION", "COMMITTED", "RENEWED", "CHURNED"}
        assert session.scalar(select(func.count()).select_from(CustomerHealth).where(
            CustomerHealth.delta_30d.is_not(None))) > 0
        assert session.scalar(select(func.count()).select_from(DashboardLink).where(
            DashboardLink.password_hash.is_not(None))) == 1
        assert session.scalar(select(func.count()).select_from(MetricWatch).where(
            MetricWatch.snoozed_until.is_not(None))) == 1
        session.scalar(select(func.count()).select_from(MetricAnomaly))

        again = seed.populate(session)
        assert again["contracts"] == again["version_histories"] == again["metric_watches"] == again["public_links"] == 0
        assert again["health_snapshots"] == 0
        assert session.scalar(select(func.count()).select_from(CustomerHealthSnapshot)) >= counts["health_snapshots"]
    finally:
        session.rollback()
        session.close()


def test_seed_safely_never_raises(monkeypatch):
    from src.core.db import new_session
    from src.seed import records_analytics as seed

    def boom(_session):
        raise RuntimeError("no")

    monkeypatch.setattr(seed, "populate", boom)
    session = new_session()
    try:
        seed.seed_safely(session)
    finally:
        session.rollback()
        session.close()


def test_earlier_values_are_plausible():
    import random

    from src.seed.records_analytics import _earlier

    rng = random.Random(1)
    assert _earlier("A", ["A", "B"], rng, "status") == "B"
    assert _earlier("A", ["A"], rng, "status") == "A"
    assert _earlier("x@y.z", None, rng, "email") == "x.old@y.z"
    assert _earlier("Fix the thing", None, rng, "title") == "Fix the"
    assert _earlier("Word", None, rng, "subject") == "Word (draft)"
    assert _earlier("Note", None, rng, "location").endswith("earlier wording")
    assert _earlier(None, None, rng, "notes").startswith("Earlier note")
    assert _earlier(5, None, rng, "count") == 5
