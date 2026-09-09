"""Dashboard aggregates must reconcile with live records and respect access."""
from datetime import datetime, timezone

import pytest
from sqlalchemy import func, select

from src.config import Config
from tests.conftest import persona_claims

PREFIX = f"{Config.API_PREFIX}/dashboard"


def authenticate(monkeypatch):
    monkeypatch.setattr("src.core.auth.verify_token", lambda _: persona_claims("admin", "administrator"))
    return {"Authorization": "Bearer dashboard-test"}


@pytest.mark.parametrize("endpoint", ["summary", "alerts"])
def test_dashboard_requires_authentication(client, endpoint):
    assert client.get(f"{PREFIX}/{endpoint}").status_code == 401


@pytest.mark.database
def test_dashboard_requires_record_access(client, monkeypatch):
    headers = authenticate(monkeypatch)
    monkeypatch.setattr("src.core.auth._permissions_for", lambda *_: set())
    assert client.get(f"{PREFIX}/summary", headers=headers).status_code == 403


@pytest.mark.database
def test_panels_reconcile_with_the_selected_period(client, monkeypatch):
    from src.core.db import session_scope
    from src.models.business import Order, Ticket

    response = client.get(f"{PREFIX}/summary?period=current_year", headers=authenticate(monkeypatch))
    assert response.status_code == 200
    body = response.get_json()
    panels = body["charts"]
    start = datetime.fromisoformat(body["period"]["from"].replace("Z", "+00:00"))
    end = datetime.fromisoformat(body["period"]["to"].replace("Z", "+00:00"))
    assert {panel["kind"] for panel in panels.values() if isinstance(panel, dict)} >= {
        "area", "line", "bar", "pie", "hbar", "stacked-area", "stacked-bar",
        "stacked-hbar", "multi-line", "scatter", "heatmap", "funnel", "gauge",
        "radar", "treemap",
    }
    with session_scope() as session:
        orders = session.scalar(select(func.count()).select_from(Order).where(
            Order.placed_at >= start, Order.placed_at < end, Order.deleted_at.is_(None)))
        resolved = session.scalar(select(func.count()).select_from(Ticket).where(
            Ticket.resolved_at >= start, Ticket.resolved_at < end, Ticket.deleted_at.is_(None)))
    stages = [point["value"] for point in panels["fulfilment_funnel"]["series"]]
    assert stages[0] == orders
    assert stages == sorted(stages, reverse=True)
    assert sum(point["value"] for point in panels["ticket_flow"]["series"]
               if point["group"] == "Resolved") == resolved
    assert all(0 <= point["value"] <= 100 for point in panels["sla_gauge"]["series"])
    assert all(point["value"] > 0 for point in panels["portfolio_budget"]["series"])

    # The stacked area's top edge is the revenue line: same orders, same
    # window, split by channel. Two panels of one number that disagree are
    # worse than one panel, and the fold into "Other" is exactly where such a
    # disagreement would come from.
    revenue = sum(point["value"] for point in panels["revenue_over_time"]["series"])
    by_channel = sum(point["value"] for point in panels["revenue_by_channel"]["series"])
    assert round(by_channel, 2) == round(revenue, 2)
    # Every cell names a group the panel declared, so nothing is drawn into a
    # stack the legend does not list.
    assert {point["group"] for point in panels["revenue_by_channel"]["series"]} <= set(
        panels["revenue_by_channel"]["groups"]
    )


@pytest.mark.database
def test_a_deleted_record_is_gone_from_every_number(client, monkeypatch):
    """A soft delete means gone from every list — the front page included.

    `open_tickets` was `~status.in_(("RESOLVED", "CLOSED"))` and nothing else,
    so every ticket anybody had ever deleted was still open on the dashboard:
    189 where the table showed 50. Fourteen of the aggregates here remembered
    the filter and the rest did not, which is worse than uniformly wrong — two
    numbers on one page disagreeing about whether a record exists.

    The rule is derived from the model now rather than remembered per query, so
    this asserts the *property* over every KPI at once: create records, delete
    them, and every number is back where it started. A new aggregate that
    forgets the filter fails this without anybody thinking to add a case.
    """
    from src.core.db import session_scope
    from src.models.business import Ticket
    from src.models.platform import ActivityEntry, AuditLog

    headers = authenticate(monkeypatch)
    url = f"{PREFIX}/summary?period=current_year"

    def numbers() -> dict[str, float]:
        body = client.get(url, headers=headers).get_json()
        return {kpi["key"]: float(kpi["value"]) for kpi in body["kpis"]}

    before = numbers()
    made: list[str] = []
    try:
        for index in range(3):
            created = client.post(
                f"{Config.API_PREFIX}/api/records/ticket",
                json={
                    "subject": f"Soft delete probe {index}",
                    "description": "Created by the dashboard test.",
                    "status": "OPEN", "priority": "NORMAL", "severity": "MINOR",
                    "category": "SUPPORT", "channel": "EMAIL",
                },
                headers=headers,
            )
            assert created.status_code == 201, created.get_json()
            made.append(created.get_json()["id"])

        # They are there while they exist — otherwise the assertion below
        # passes on a dashboard that counts nothing at all.
        assert numbers()["open_tickets"] == before["open_tickets"] + 3

        for record_id in made:
            assert client.delete(
                f"{Config.API_PREFIX}/api/records/ticket/{record_id}", headers=headers
            ).status_code == 200

        assert numbers() == before
    finally:
        with session_scope() as session:
            for record_id in made:
                session.query(ActivityEntry).filter(
                    ActivityEntry.resource_id == record_id
                ).delete(synchronize_session=False)
                session.query(AuditLog).filter(
                    AuditLog.resource_id == record_id
                ).delete(synchronize_session=False)
                session.query(Ticket).filter(Ticket.id == record_id).delete(
                    synchronize_session=False
                )


@pytest.mark.database
def test_no_tickets_does_not_claim_perfect_sla_compliance():
    from src.core.db import session_scope
    from src.models.business import Ticket
    from src.services.dashboard import _sla_gauge

    with session_scope() as session:
        assert _sla_gauge(session, Ticket, datetime(1900, 1, 1, tzinfo=timezone.utc),
                          datetime(1900, 1, 2, tzinfo=timezone.utc)) == []
