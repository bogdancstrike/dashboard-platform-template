"""Anomaly alerts (§22): watch a metric and notify on a spike or a drop.

The claims:

* **Detection is explainable**: a point is judged against the mean and spread
  of a rolling window (or the same slot in earlier cycles), with a floored
  spread, a direction, and a sensitivity that is a z threshold.
* **The bucket still in progress can spike but not drop.**
* **A firing is recorded with its window and notifies** in-app and, when asked,
  by an email in the outbox; a snoozed or muted watch records but stays quiet.
* **The watch is a question the explorer can ask**: datasets, measures, dates
  and filters are checked against the dataset's own declaration.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest

from src.config import Config
from src.core.clock import now
from src.services import metric_watches as service
from tests.conftest import persona_claims

PREFIX = Config.API_PREFIX
BASE = f"{PREFIX}/api/alerts"


def _auth(monkeypatch, username: str = "admin", role: str = "administrator") -> dict[str, str]:
    monkeypatch.setattr("src.core.auth.tokens.verify_token",
                        lambda _t: persona_claims(username, role, sid=f"alerts-{username}"))
    return {"Authorization": f"Bearer alerts-{username}"}


CONFIG = {"measure": "count", "granularity": "day", "method": "zscore", "sensitivity": "medium",
          "direction": "both", "window": 7, "threshold": None}


# ── detection ────────────────────────────────────────────────────────────


def test_a_spike_against_a_steady_window_is_unusual():
    values = [10, 11, 9, 10, 12, 10, 9, 40]
    verdict = service.judge(values, 7, CONFIG)
    assert verdict["unusual"] is True
    assert verdict["direction"] == "up"
    assert verdict["severity"] == "CRITICAL"
    assert verdict["expected"] == pytest.approx(10.14, abs=0.01)
    assert verdict["upper"] > verdict["expected"] > verdict["lower"]


def test_an_ordinary_point_is_not():
    values = [10, 11, 9, 10, 12, 10, 9, 11]
    assert service.judge(values, 7, CONFIG)["unusual"] is False


def test_too_little_history_is_no_verdict():
    assert service.judge([1, 2, 30], 2, CONFIG) is None


def test_a_drop_respects_direction_and_the_partial_bucket():
    values = [50, 52, 49, 51, 50, 48, 50, 5]
    assert service.judge(values, 7, CONFIG)["unusual"] is True
    assert service.judge(values, 7, CONFIG, partial=True)["unusual"] is False
    assert service.judge(values, 7, {**CONFIG, "direction": "up"})["unusual"] is False
    assert service.judge(values, 7, {**CONFIG, "direction": "down"})["direction"] == "down"


def test_a_flat_zero_baseline_does_not_make_one_row_infinite():
    values = [0, 0, 0, 0, 0, 0, 0, 1]
    verdict = service.judge(values, 7, CONFIG)
    assert verdict["stddev"] == 1.0
    assert verdict["unusual"] is False
    assert service.judge([0] * 7 + [5], 7, CONFIG)["unusual"] is True
    averaged = service.judge([0.0] * 7 + [0.5], 7, {**CONFIG, "measure": "avg"})
    assert averaged["stddev"] < 0.001
    assert averaged["lower"] < 0 or averaged["lower"] == pytest.approx(0, abs=1e-3)


def test_sensitivity_and_an_explicit_threshold():
    assert service.threshold_of({"sensitivity": "high"}) == 2.2
    assert service.threshold_of({"sensitivity": "low"}) == 4.0
    assert service.threshold_of({"sensitivity": "zany"}) == 3.0
    assert service.threshold_of({"sensitivity": "low", "threshold": 1.5}) == 1.5


def test_seasonal_reads_the_same_slot_in_earlier_cycles():
    week = [5, 5, 5, 5, 5, 40, 40]
    values = week * 5
    seasonal = {**CONFIG, "method": "seasonal", "granularity": "day"}
    # A Saturday at the usual Saturday level is not a spike seasonally …
    assert service.judge(values, 33, seasonal)["unusual"] is False
    assert service.baseline(values, 33, seasonal) == [40, 40, 40, 40]
    # … though against the rolling window it would be.
    assert service.judge(values, 33, {**CONFIG, "window": 5})["unusual"] is True


def test_annotate_adds_the_band_to_every_judged_point():
    points = [{"at": f"2026-01-{i + 1:02d}T00:00:00+00:00", "value": v} for i, v in enumerate([3, 3, 3, 3, 30])]
    out = service.annotate(points, {**CONFIG, "window": 3})
    assert "expected" not in out[0]
    assert out[-1]["unusual"] is True


def test_floor_aligns_buckets():
    moment = datetime(2026, 11, 12, 15, 42, tzinfo=timezone.utc)  # a Thursday
    assert service._floor(moment, "hour").hour == 15
    assert service._floor(moment, "day").hour == 0
    assert service._floor(moment, "week").weekday() == 0


def test_numbers_read_well():
    assert service._number(1234.0) == "1,234"
    assert service._number(2.5) == "2.50"


# ── validation ───────────────────────────────────────────────────────────


@pytest.mark.parametrize("payload,field", [
    ({"name": ""}, "name"),
    ({"name": "x", "dataset": "ticket", "measure": "median"}, "measure"),
    ({"name": "x", "dataset": "ticket", "granularity": "minute"}, "granularity"),
    ({"name": "x", "dataset": "ticket", "filters": []}, "filters"),
    ({"name": "x", "dataset": "ticket", "threshold": "high"}, "threshold"),
    ({"name": "x", "dataset": "ticket", "threshold": 20}, "threshold"),
    ({"name": "x", "dataset": "ticket", "window": "a"}, "window"),
    ({"name": "x", "dataset": "ticket", "window": 1}, "window"),
    ({"name": "x", "dataset": "ticket", "channels": ["pigeon"]}, "channels"),
    ({"name": "x", "dataset": "ticket", "recipient_ids": "me"}, "recipient_ids"),
])
def test_validation_names_the_field(payload, field):
    from src.core.errors import ValidationError

    with pytest.raises(ValidationError) as caught:
        service.validated(payload)
    assert caught.value.details.get("field") == field


def test_validation_fills_the_defaults():
    values = service.validated({"name": "Tickets", "dataset": "ticket", "threshold": "", "enabled": 0,
                                "recipient_ids": [str(uuid4())], "description": " "})
    assert values["measure"] == "count" and values["granularity"] == "day"
    assert values["channels"] == ["in_app"]
    assert values["threshold"] is None
    assert values["enabled"] is False
    assert values["description"] is None
    assert service.validated({"window": 30}, partial=True) == {"window": 30}
    from src.core.errors import ValidationError

    with pytest.raises(ValidationError):
        service.validated([])


def test_a_measure_must_be_a_number_of_the_dataset():
    from src.core.errors import ValidationError

    with pytest.raises(ValidationError):
        service._check_measure({"dataset": "order", "measure": "sum", "measure_field": "status", "filters": {}})
    with pytest.raises(ValidationError):
        service._check_measure({"dataset": "order", "measure": "count", "filters": {"planet": "x"}})
    config = {"dataset": "order", "measure": "count", "measure_field": "total",
              "filters": {"total_min": 5, "status__in": "PENDING", "q": "x"}}
    service._check_measure(config)
    assert config["measure_field"] is None


# ── the API ──────────────────────────────────────────────────────────────


@pytest.fixture()
def spike(client):
    """Twenty tickets created now — an unmistakable hourly spike."""
    from src.core.db import session_scope
    from src.models.business import Ticket

    ids = []
    with session_scope() as session:
        for index in range(20):
            row = Ticket(reference=f"TKT-Z{uuid4().hex[:8]}", subject=f"Spike probe {index}", priority="CRITICAL")
            session.add(row)
            session.flush()
            ids.append(row.id)
    yield ids


@pytest.mark.database
def test_alerts_need_a_token(client):
    assert client.get(f"{BASE}/watches").status_code == 401


@pytest.mark.database
def test_the_catalogue_names_what_a_watch_may_ask(client, monkeypatch):
    body = client.get(f"{BASE}/catalogue", headers=_auth(monkeypatch)).get_json()
    tickets = next(d for d in body["datasets"] if d["key"] == "ticket")
    assert tickets["default_date"] == "created_at"
    assert any(f["name"] == "priority" for f in tickets["filters"])
    assert body["can_manage"] is True
    assert set(body["granularities"]) == {"hour", "day", "week"}


@pytest.mark.database
def test_a_spike_fires_records_and_notifies(client, monkeypatch, spike):
    headers = _auth(monkeypatch)
    from sqlalchemy import select

    from src.core.db import session_scope
    from src.models.content import EmailMessage
    from src.models.identity import User
    from src.models.platform import Notification

    with session_scope() as session:
        manager_id = str(session.scalars(select(User).where(User.username == "manager")).first().id)
    preview = client.post(f"{BASE}/preview", json={
        "dataset": "ticket", "granularity": "hour", "sensitivity": "high", "filters": {"priority": "CRITICAL"},
    }, headers=headers).get_json()
    assert preview["flagged"] >= 1
    assert preview["threshold"] == 2.2

    made = client.post(f"{BASE}/watches", json={
        "name": "Critical tickets per hour (probe)", "dataset": "ticket", "granularity": "hour",
        "sensitivity": "high", "filters": {"priority": "CRITICAL"}, "channels": ["in_app", "email"],
        "recipient_ids": [manager_id], "window": 12,
    }, headers=headers)
    assert made.status_code == 201, made.get_json()
    watch = made.get_json()
    # The backfill on create records history without telling anybody.
    assert watch["last_status"] == "ANOMALY"
    chart = client.get(f"{BASE}/watches/{watch['id']}/chart?points=24", headers=headers).get_json()
    assert len(chart["points"]) == 24
    assert chart["points"][-1]["unusual"] is True
    assert chart["anomalies"][-1]["direction"] == "up"
    with session_scope() as session:
        assert not session.scalars(select(Notification).where(Notification.group_key == f"anomaly:{watch['id']}")).all()

    # Evaluated again after the history is cleared, it fires and tells people.
    from src.models.records_analytics import MetricAnomaly

    with session_scope() as session:
        session.query(MetricAnomaly).filter(MetricAnomaly.watch_id == watch["id"]).delete()
    fired = client.post(f"{BASE}/watches/{watch['id']}/evaluate", headers=headers).get_json()
    assert fired["new"] >= 1
    assert fired["status"] == "ANOMALY"
    with session_scope() as session:
        told = session.scalars(select(Notification).where(Notification.group_key == f"anomaly:{watch['id']}")).all()
        assert {str(n.user_id) for n in told} >= {manager_id}
        assert told[0].title.endswith("unusual spike")
        assert session.scalars(select(EmailMessage).where(EmailMessage.subject.like("Critical tickets per hour (probe)%"))).first()

    listed = client.get(f"{BASE}/anomalies?watch_id={watch['id']}&status=open&direction=up", headers=headers).get_json()
    assert listed["total"] >= 1
    one = listed["items"][0]
    assert one["series"] and one["granularity"] == "hour"
    assert client.get(f"{BASE}/anomalies/{one['id']}", headers=headers).get_json()["id"] == one["id"]
    seen = client.post(f"{BASE}/anomalies/{one['id']}/acknowledge", headers=headers).get_json()
    assert seen["status"] == "ACKNOWLEDGED"
    assert client.post(f"{BASE}/anomalies/{one['id']}/acknowledge", headers=headers).get_json()["status"] == "ACKNOWLEDGED"
    assert client.get(f"{BASE}/anomalies/{uuid4()}", headers=headers).status_code == 404
    assert client.post(f"{BASE}/anomalies/{uuid4()}/acknowledge", headers=headers).status_code == 404
    assert client.get(f"{BASE}/anomalies?page=x", headers=headers).status_code == 400

    everything = client.get(f"{BASE}/watches?q=probe", headers=headers).get_json()
    entry = next(item for item in everything["items"] if item["id"] == watch["id"])
    assert entry["sparkline"] and entry["last_anomaly_at"]
    assert client.get(f"{BASE}/watches?status=ANOMALY", headers=headers).status_code == 200


@pytest.mark.database
def test_a_silenced_watch_records_but_stays_quiet(client, monkeypatch, spike):
    headers = _auth(monkeypatch)
    from sqlalchemy import select

    from src.core.db import session_scope
    from src.models.platform import Notification
    from src.models.records_analytics import MetricAnomaly

    watch = client.post(f"{BASE}/watches", json={
        "name": "Snoozed probe", "dataset": "ticket", "granularity": "hour", "sensitivity": "high",
        "filters": {"priority": "CRITICAL"},
    }, headers=headers).get_json()
    snoozed = client.post(f"{BASE}/watches/{watch['id']}/silence", json={"hours": 4}, headers=headers).get_json()
    assert snoozed["snoozed_until"]
    with session_scope() as session:
        session.query(MetricAnomaly).filter(MetricAnomaly.watch_id == watch["id"]).delete()
    client.post(f"{BASE}/watches/{watch['id']}/evaluate", headers=headers)
    with session_scope() as session:
        rows = session.scalars(select(MetricAnomaly).where(MetricAnomaly.watch_id == watch["id"])).all()
        assert rows and all(r.suppressed_reason == "snoozed" and not r.notified for r in rows if r.status == "OPEN")
        assert not session.scalars(select(Notification).where(Notification.group_key == f"anomaly:{watch['id']}")).all()

    muted = client.post(f"{BASE}/watches/{watch['id']}/silence", json={"muted": True}, headers=headers).get_json()
    assert muted["muted"] is True
    with session_scope() as session:
        session.query(MetricAnomaly).filter(MetricAnomaly.watch_id == watch["id"]).delete()
    client.post(f"{BASE}/watches/{watch['id']}/evaluate", headers=headers)
    with session_scope() as session:
        reasons = {r.suppressed_reason for r in session.scalars(
            select(MetricAnomaly).where(MetricAnomaly.watch_id == watch["id"], MetricAnomaly.status == "OPEN"))}
        assert reasons == {"muted"}

    until = (now() + timedelta(days=1)).isoformat()
    assert client.post(f"{BASE}/watches/{watch['id']}/silence", json={"until": until}, headers=headers).get_json()["snoozed_until"]
    cleared = client.post(f"{BASE}/watches/{watch['id']}/silence", json={"clear": True}, headers=headers).get_json()
    assert cleared["muted"] is False and cleared["snoozed_until"] is None
    for bad in ({"hours": "x"}, {"hours": 0}, {"until": "soon"}, {"until": "2001-01-01T00:00:00"}):
        assert client.post(f"{BASE}/watches/{watch['id']}/silence", json=bad, headers=headers).status_code == 400
    assert client.post(f"{BASE}/watches/{watch['id']}/silence", json=[], headers=headers).status_code == 400


@pytest.mark.database
def test_editing_deleting_and_permissions(client, monkeypatch):
    headers = _auth(monkeypatch)
    watch = client.post(f"{BASE}/watches", json={
        "name": "Revenue probe", "dataset": "order", "measure": "sum", "measure_field": "total",
        "granularity": "week", "method": "seasonal",
    }, headers=headers).get_json()
    assert watch["measure_field"] == "total"
    renamed = client.put(f"{BASE}/watches/{watch['id']}", json={"name": "Revenue probe 2", "enabled": False},
                         headers=headers).get_json()
    assert renamed["name"] == "Revenue probe 2" and renamed["enabled"] is False
    recounted = client.put(f"{BASE}/watches/{watch['id']}", json={"measure": "count", "window": 10}, headers=headers)
    assert recounted.get_json()["measure_field"] is None
    assert client.put(f"{BASE}/watches/{watch['id']}", json={"measure": "sum", "measure_field": "status"},
                      headers=headers).status_code == 400
    assert client.get(f"{BASE}/watches/{watch['id']}", headers=headers).get_json()["window"] == 10

    viewer = _auth(monkeypatch, "user", "viewer")
    assert client.get(f"{BASE}/watches/{watch['id']}", headers=viewer).status_code == 200
    assert client.post(f"{BASE}/watches", json={"name": "x", "dataset": "ticket"}, headers=viewer).status_code == 403
    assert client.delete(f"{BASE}/watches/{watch['id']}", headers=viewer).status_code == 403
    assert client.post(f"{BASE}/run", headers=viewer).status_code == 403

    headers = _auth(monkeypatch)
    assert client.delete(f"{BASE}/watches/{watch['id']}", headers=headers).get_json()["deleted"] is True
    assert client.get(f"{BASE}/watches/{watch['id']}", headers=headers).status_code == 404
    assert client.get(f"{BASE}/watches/{watch['id']}/chart?points=x", headers=headers).status_code == 404


@pytest.mark.database
def test_run_all_is_a_recorded_job(client, monkeypatch):
    body = client.post(f"{BASE}/run", headers=_auth(monkeypatch)).get_json()
    assert body["status"] == "SUCCEEDED"
    assert body["watches"] >= 0


@pytest.mark.database
def test_a_broken_watch_reports_its_error(client, monkeypatch):
    from src.core.db import session_scope
    from src.models.records_analytics import MetricWatch

    headers = _auth(monkeypatch)
    watch = client.post(f"{BASE}/watches", json={"name": "Breaks", "dataset": "ticket"}, headers=headers).get_json()
    with session_scope() as session:
        row = session.get(MetricWatch, watch["id"])
        row.measure, row.measure_field = "sum", "subject"
    result = client.post(f"{BASE}/watches/{watch['id']}/evaluate", headers=headers).get_json()
    assert result["status"] == "ERROR"
    assert "number field" in result["error"]
    listed = client.get(f"{BASE}/watches?q=Breaks", headers=headers).get_json()
    assert listed["items"][0]["sparkline"] == []
    chart = client.get(f"{BASE}/watches/{watch['id']}/chart", headers=headers)
    assert chart.status_code == 400


@pytest.mark.database
def test_a_dataset_without_data_is_no_data(client, monkeypatch):
    headers = _auth(monkeypatch)
    watch = client.post(f"{BASE}/watches", json={
        "name": "Nothing probe", "dataset": "ticket", "filters": {"subject": "zz-no-ticket-has-this"},
    }, headers=headers).get_json()
    assert watch["last_status"] == "NO_DATA"


def test_recipients_are_unique_and_parsed():
    class Row:
        owner_id = uuid4()
        recipient_ids = None

    row = Row()
    row.recipient_ids = [str(row.owner_id), str(uuid4())]
    assert len(service._recipients(row)) == 2
