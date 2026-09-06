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
        "area", "line", "bar", "pie", "hbar", "stacked-bar", "stacked-hbar",
        "multi-line", "scatter", "heatmap", "funnel", "gauge", "radar", "treemap",
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


@pytest.mark.database
def test_no_tickets_does_not_claim_perfect_sla_compliance():
    from src.core.db import session_scope
    from src.models.business import Ticket
    from src.services.dashboard import _sla_gauge

    with session_scope() as session:
        assert _sla_gauge(session, Ticket, datetime(1900, 1, 1, tzinfo=timezone.utc),
                          datetime(1900, 1, 2, tzinfo=timezone.utc)) == []
