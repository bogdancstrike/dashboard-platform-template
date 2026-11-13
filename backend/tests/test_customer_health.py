"""Customer health (§12): a weighted model from tickets, orders and usage, with trend.

The claims:

* **The score is the weighted mean of four signals, and says why.** Each
  signal's facts are the inputs in words, and the contributions add up to the
  score.
* **The model is an administrator's**, validated (cut-offs in order, weights
  that are not all zero), audited, and applied at once.
* **A recompute snapshots today and reports band drops**, which notify the
  account manager — or, with none, the people who may configure the model.
* **The customers list filters and sorts by health** like any other column.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest

from src.config import Config
from src.core.errors import ForbiddenError, NotFoundError, ValidationError
from src.services.records import customer_health as service
from tests.conftest import persona_claims

PREFIX = Config.API_PREFIX
BASE = f"{PREFIX}/api/customer-health"
TODAY = datetime(2026, 11, 12, 12, 0, tzinfo=timezone.utc)


def _auth(monkeypatch, username: str = "admin", role: str = "administrator") -> dict[str, str]:
    monkeypatch.setattr("src.core.auth.tokens.verify_token",
                        lambda _t: persona_claims(username, role, sid=f"health-{username}"))
    return {"Authorization": f"Bearer health-{username}"}


# ── the pure model ───────────────────────────────────────────────────────


def test_a_quiet_happy_account_scores_high_and_explains_itself():
    inputs = service.Inputs(
        orders_recent=6, orders_previous=4, value_recent=12000, value_previous=8000,
        last_order_at=TODAY - timedelta(days=5), devices=4, devices_online=4,
        last_contact_at=TODAY - timedelta(days=3),
        contract={"reference": "CTR-1", "stage": "COMMITTED", "probability": 90, "days_to_end": 40},
    )
    result = service.score(inputs, service.DEFAULT_WEIGHTS, {}, today=TODAY)
    assert result["band"] == "HEALTHY"
    parts = result["components"]
    assert parts["tickets"]["score"] == 100
    assert parts["tickets"]["facts"][0]["text"] == "No open support tickets"
    assert parts["renewal"]["score"] == 100
    assert "committed to renew" in parts["renewal"]["facts"][0]["text"]
    # The contributions are the score.
    assert round(sum(p["contribution"] for p in parts.values())) == result["score"]
    assert {p["share"] for p in parts.values()} == {30.0, 25.0, 15.0}


def test_problems_take_points_off_and_name_themselves():
    inputs = service.Inputs(open_tickets=3, escalated=2, breached=1, last_order_at=None,
                            last_contact_at=None, contract={"reference": "CTR-9", "stage": "CHURNED",
                                                            "probability": 0, "days_to_end": -5})
    result = service.score(inputs, service.DEFAULT_WEIGHTS, {}, today=TODAY)
    parts = result["components"]
    assert parts["tickets"]["score"] == 100 - 3 * 5 - 2 * 15 - 12
    texts = [fact["text"] for fact in parts["tickets"]["facts"]]
    assert texts == ["3 open tickets", "2 escalated tickets", "1 SLA breach in 90 days"]
    assert parts["orders"]["facts"][0]["text"] == "No orders yet"
    assert parts["usage"]["facts"][0]["text"] == "No devices under management"
    assert parts["usage"]["facts"][1]["text"] == "Never contacted"
    assert parts["renewal"]["score"] == 0
    assert result["band"] == "CRITICAL"


def test_renewal_weighs_proximity_and_probability():
    near = service.Inputs(contract={"reference": "C", "stage": "NEGOTIATION", "probability": 50, "days_to_end": 12})
    far = service.Inputs(contract={"reference": "C", "stage": "UPCOMING", "probability": 50, "days_to_end": 400})
    ended = service.Inputs(contract={"reference": "C", "stage": "UPCOMING", "probability": 50, "days_to_end": -3})
    none = service.Inputs()
    score = lambda i: service.score(i, service.DEFAULT_WEIGHTS, {}, today=TODAY)["components"]["renewal"]  # noqa: E731
    assert score(far)["score"] > score(near)["score"]
    assert "ends in 12 days" in score(near)["facts"][0]["text"]
    assert "ended 3 days ago" in score(ended)["facts"][0]["text"]
    assert score(none)["score"] == 70
    assert score(none)["facts"][0]["text"] == "No contract on file"


def test_usage_reads_devices_and_contact():
    online = service.Inputs(devices=10, devices_online=8, device_errors=3, last_contact_at=TODAY - timedelta(days=1))
    parts = service.score(online, service.DEFAULT_WEIGHTS, {}, today=TODAY)["components"]["usage"]
    texts = [f["text"] for f in parts["facts"]]
    assert texts[0] == "8 of 10 devices online"
    assert "3 device errors reported" in texts
    assert texts[-1] == "Last contact 1 day ago"


@pytest.mark.parametrize("recent,previous,expected", [(0, 0, 30.0), (5, 0, 100.0), (10, 5, 100.0), (5, 10, 25.0), (0, 4, 0.0)])
def test_trend_is_fifty_when_flat(recent, previous, expected):
    assert service._trend(recent, previous) == expected
    assert service._trend(4, 4) == 50.0


def test_bands_follow_the_cut_offs():
    thresholds = {"bands": {"healthy": 80, "at_risk": 50}}
    assert service.band_for(80, thresholds) == "HEALTHY"
    assert service.band_for(79, thresholds) == "AT_RISK"
    assert service.band_for(49, thresholds) == "CRITICAL"


def test_weights_are_normalised_and_zero_weights_ignored():
    inputs = service.Inputs(open_tickets=20)
    only_tickets = service.score(inputs, {"tickets": 10, "orders": 0, "usage": 0, "renewal": 0}, {}, today=TODAY)
    assert only_tickets["score"] == 0
    assert only_tickets["components"]["orders"]["contribution"] == 0


def test_merged_thresholds_ignore_unknown_keys():
    merged = service._merged(service.DEFAULT_THRESHOLDS, {"bands": {"healthy": 90, "bogus": 1}, "nope": {}})
    assert merged["bands"] == {"healthy": 90, "at_risk": 40}
    assert "nope" not in merged


# ── the API ──────────────────────────────────────────────────────────────


@pytest.fixture()
def restore_model():
    """The model is live configuration — put it back however the test ends."""
    from src.core.db import session_scope

    with session_scope() as session:
        row = service.active_model(session)
        saved = (dict(row.weights), {k: dict(v) for k, v in (row.thresholds or {}).items()}, row.name)
    yield
    with session_scope() as session:
        row = service.active_model(session)
        row.weights, row.thresholds, row.name = saved
    with session_scope() as session:
        service.recompute(session, notify=False)


@pytest.mark.database
def test_health_needs_a_token(client):
    assert client.get(BASE).status_code == 401


@pytest.mark.database
def test_the_portfolio_has_a_distribution_movers_and_a_list(client, monkeypatch):
    headers = _auth(monkeypatch)
    body = client.get(f"{BASE}?page_size=5&sort=score&order=asc", headers=headers).get_json()
    assert body["total"] > 0
    assert sum(item["count"] for item in body["distribution"]) == body["total"]
    assert sum(item["count"] for item in body["histogram"]) == body["total"]
    assert len(body["items"]) <= 5
    scores = [item["score"] for item in body["items"]]
    assert scores == sorted(scores)
    assert set(body["movers"]) == {"period", "up", "down"}
    assert body["can_configure"] is True

    critical = client.get(f"{BASE}?band=critical&period=7d&sort=delta&order=desc", headers=headers).get_json()
    assert all(item["band"] == "CRITICAL" for item in critical["items"])
    assert critical["movers"]["period"] == "7d"
    named = client.get(f"{BASE}?q=zzzz-no-such-customer", headers=headers).get_json()
    assert named["matching"] == 0
    for key in ("name", "value"):
        assert client.get(f"{BASE}?sort={key}", headers=headers).status_code == 200
    assert client.get(f"{BASE}?page=x", headers=headers).status_code == 400


@pytest.mark.database
def test_one_customer_has_a_score_a_breakdown_and_a_trend(client, monkeypatch):
    headers = _auth(monkeypatch)
    first = client.get(f"{BASE}?page_size=1", headers=headers).get_json()["items"][0]
    body = client.get(f"{BASE}/customers/{first['id']}?days=30", headers=headers).get_json()
    assert body["customer"]["id"] == first["id"]
    assert body["band"] in service.BANDS
    assert [c["key"] for c in body["components"]] == list(service.SIGNALS)
    assert all(point["day"] for point in body["trend"])
    assert set(body["thresholds"]) == {"healthy", "at_risk"}
    assert client.get(f"{BASE}/customers/{first['id']}?days=nope", headers=headers).status_code == 200
    assert client.get(f"{BASE}/customers/{uuid4()}", headers=headers).status_code == 404


@pytest.mark.database
def test_a_customer_without_a_score_is_scored_on_first_read(client, monkeypatch):
    headers = _auth(monkeypatch)
    made = client.post(f"{PREFIX}/api/records/customer", json={"name": "Health probe account"}, headers=headers)
    assert made.status_code == 201, made.get_json()
    body = client.get(f"{BASE}/customers/{made.get_json()['id']}", headers=headers).get_json()
    assert body["score"] >= 0
    assert body["components"][1]["facts"][0]["text"] == "No orders yet"


@pytest.mark.database
def test_the_model_is_read_by_anyone_and_changed_by_a_configurer(client, monkeypatch, restore_model):
    viewer = _auth(monkeypatch, "user", "viewer")
    model = client.get(f"{BASE}/model", headers=viewer).get_json()
    assert set(model["weights"]) == set(service.SIGNALS)
    assert model["can_configure"] is False
    refused = client.put(f"{BASE}/model", json={"weights": {"tickets": 50}}, headers=viewer)
    assert refused.status_code == 403

    admin = _auth(monkeypatch)
    saved = client.put(f"{BASE}/model", json={
        "name": "Support-heavy", "weights": {"tickets": 50, "orders": 20},
        "thresholds": {"bands": {"healthy": 72, "at_risk": 41}, "tickets": {"open": 4}},
    }, headers=admin)
    assert saved.status_code == 200, saved.get_json()
    body = saved.get_json()
    assert body["name"] == "Support-heavy"
    assert body["weights"]["tickets"] == 50
    assert body["thresholds"]["bands"] == {"healthy": 72, "at_risk": 41}
    assert body["recomputed"]["customers"] > 0


@pytest.mark.database
@pytest.mark.parametrize("payload,field", [
    ([], None),
    ({"weights": []}, "weights"),
    ({"weights": {"vibes": 3}}, "weights.vibes"),
    ({"weights": {"tickets": "x"}}, "weights.tickets"),
    ({"weights": {"tickets": 101}}, "weights.tickets"),
    ({"weights": {"tickets": 0, "orders": 0, "usage": 0, "renewal": 0}}, "weights"),
    ({"thresholds": []}, "thresholds"),
    ({"thresholds": {"moods": {}}}, "thresholds.moods"),
    ({"thresholds": {"bands": {"vibe": 3}}}, "thresholds.bands.vibe"),
    ({"thresholds": {"bands": {"healthy": 40, "at_risk": 60}}}, "thresholds.bands.at_risk"),
])
def test_a_bad_model_is_refused_with_the_field(client, monkeypatch, restore_model, payload, field):
    headers = _auth(monkeypatch)
    response = client.put(f"{BASE}/model", json=payload, headers=headers)
    assert response.status_code == 400
    if field:
        assert response.get_json()["details"]["field"] == field


@pytest.mark.database
def test_recompute_is_a_job_and_needs_the_permission(client, monkeypatch):
    viewer = _auth(monkeypatch, "user", "viewer")
    assert client.post(f"{BASE}/recompute", headers=viewer).status_code == 403
    admin = _auth(monkeypatch)
    body = client.post(f"{BASE}/recompute", headers=admin).get_json()
    assert body["status"] == "SUCCEEDED"
    assert body["customers"] > 0


@pytest.mark.database
def test_a_band_drop_notifies_the_account_manager_or_the_configurers(monkeypatch):
    from sqlalchemy import select

    from src.core.db import session_scope
    from src.models.business import Customer
    from src.models.identity import User
    from src.models.platform import Notification
    from src.models.records_analytics import CustomerHealth

    with session_scope() as session:
        manager = session.scalars(select(User).where(User.username == "manager")).first()
        managed = Customer(code=f"CUS-H{uuid4().hex[:6]}", name="Drop probe managed", account_manager_id=manager.id)
        orphan = Customer(code=f"CUS-H{uuid4().hex[:6]}", name="Drop probe orphan")
        session.add_all([managed, orphan])
        session.flush()
        ids = [managed.id, orphan.id]
        service.recompute(session, notify=False, customer_ids=ids)
        for row in session.scalars(select(CustomerHealth).where(CustomerHealth.customer_id.in_(ids))):
            row.band = "HEALTHY"
        session.flush()
        result = service.recompute(session, notify=True, customer_ids=ids)
        assert result["dropped"] == 2
        to_manager = session.scalars(select(Notification).where(
            Notification.group_key == f"health:{managed.id}")).all()
        assert [n.user_id for n in to_manager] == [manager.id]
        assert "dropped to" in to_manager[0].title
        to_configurers = session.scalars(select(Notification).where(
            Notification.group_key == f"health:{orphan.id}")).all()
        assert len(to_configurers) >= 1
        health = session.scalars(select(CustomerHealth).where(CustomerHealth.customer_id == managed.id)).first()
        assert health.previous_band == "HEALTHY"
        assert health.band_changed_at is not None
        # And improving back is counted, not alerted.
        health.band = "CRITICAL"
        session.flush()
        again = service.recompute(session, notify=True, customer_ids=[managed.id])
        assert again["improved"] == 1


@pytest.mark.database
def test_recompute_of_nobody_is_a_no_op():
    from src.core.db import session_scope

    with session_scope() as session:
        assert service.recompute(session, notify=False, customer_ids=[uuid4()])["customers"] == 0


@pytest.mark.database
def test_recompute_with_a_principal_requires_configure():
    from src.core.db import session_scope

    class Viewer:
        def require(self, *_):
            raise ForbiddenError("no")

    with session_scope() as session:
        with pytest.raises(ForbiddenError):
            service.recompute(session, principal=Viewer())


@pytest.mark.database
def test_customers_list_filters_and_sorts_by_health(client, monkeypatch):
    headers = _auth(monkeypatch)
    body = client.post(f"{PREFIX}/api/explorer/query", json={
        "resource_type": "customer", "columns": ["name", "health_score", "health_band"],
        "filters": {"health_band": "CRITICAL"}, "sort": "health_score", "order": "asc", "page_size": 10,
        "facets": True,
    }, headers=headers).get_json()
    assert body["items"], body
    assert all(item["health_band"] == "CRITICAL" for item in body["items"])
    scores = [item["health_score"] for item in body["items"]]
    assert scores == sorted(scores)
    assert "health_band" in body["facets"]


def test_unknown_customer_raises_not_found_without_http(monkeypatch):
    class Session:
        def scalars(self, *_):
            class R:
                def first(self):
                    return None
            return R()

    class Admin:
        def require(self, *_):
            return None

    with pytest.raises(NotFoundError):
        service.customer(Session(), uuid4(), principal=Admin())
    with pytest.raises(ValidationError):
        service.save_model(None, [], principal=Admin())
