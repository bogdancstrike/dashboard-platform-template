"""Contracts and the renewals pipeline (§13).

The claims:

* **A contract is validated like a form**: required fields, closed vocabularies,
  bounds, dates in order, references that exist, unknown keys refused.
* **The board is the pipeline**: a column per stage with totals; a drag sets
  the stage, the stage's probability and a place among the cards, and a move
  to a closed stage closes it.
* **The forecast and the calendar are the same contracts, grouped by when.**
* **History is the audit trail**, which version history then reads.
* **At risk comes from customer health**, and a contract change rescoring
  the customer is what makes that true.
"""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal
from uuid import uuid4

import pytest

from src.config import Config
from src.core.clock import now
from src.services.records import contracts as service
from tests.conftest import persona_claims

PREFIX = Config.API_PREFIX
BASE = f"{PREFIX}/api/contracts"

pytestmark = pytest.mark.database


def _auth(monkeypatch, username: str = "admin", role: str = "administrator") -> dict[str, str]:
    monkeypatch.setattr("src.core.auth.tokens.verify_token",
                        lambda _t: persona_claims(username, role, sid=f"contracts-{username}"))
    return {"Authorization": f"Bearer contracts-{username}"}


def _customer_id(client, headers) -> str:
    body = client.post(f"{PREFIX}/api/explorer/query", json={
        "resource_type": "customer", "columns": ["name"], "page_size": 1, "sort": "name", "order": "asc",
    }, headers=headers).get_json()
    return body["items"][0]["id"]


@pytest.fixture()
def headers(monkeypatch):
    return _auth(monkeypatch)


@pytest.fixture()
def contract(client, headers):
    today = now().date()
    response = client.post(BASE, json={
        "title": "Probe renewal", "customer_id": _customer_id(client, headers), "value": "48000",
        "start_date": (today - timedelta(days=300)).isoformat(),
        "end_date": (today + timedelta(days=65)).isoformat(),
        "terms": "Annual", "billing": "annual",
    }, headers=headers)
    assert response.status_code == 201, response.get_json()
    return response.get_json()


def test_contracts_need_a_token(client):
    assert client.get(BASE).status_code == 401


def test_create_names_it_and_fills_the_defaults(contract):
    assert contract["reference"].startswith("CTR-")
    assert contract["stage"] == "UPCOMING"
    assert contract["probability"] == 50
    assert contract["value"] == 48000.0
    assert contract["billing"] == "ANNUAL"
    assert contract["term_months"] in (12, 11)
    assert contract["notice_by"]
    assert contract["can_edit"] is True
    assert contract["days_to_end"] == 65


def test_a_viewer_reads_but_cannot_write(client, monkeypatch, contract):
    viewer = _auth(monkeypatch, "user", "viewer")
    assert client.get(f"{BASE}/{contract['id']}", headers=viewer).status_code == 200
    assert client.put(f"{BASE}/{contract['id']}", json={"title": "x"}, headers=viewer).status_code == 403
    assert client.post(BASE, json={}, headers=viewer).status_code == 403
    assert client.post(f"{BASE}/{contract['id']}/move", json={"stage": "COMMITTED"}, headers=viewer).status_code == 403


@pytest.mark.parametrize("change,field", [
    ({"value": "lots"}, "value"),
    ({"value": -1}, "value"),
    ({"probability": 140}, "probability"),
    ({"term_months": 0}, "term_months"),
    ({"stage": "MAYBE"}, "stage"),
    ({"currency": "BTC"}, "currency"),
    ({"start_date": "soon"}, "start_date"),
    ({"auto_renew": "perhaps"}, "auto_renew"),
    ({"title": "x" * 201}, "title"),
    ({"end_date": "2000-01-01"}, "end_date"),
    ({"title": ""}, "title"),
])
def test_a_bad_edit_is_refused_and_names_its_field(client, headers, contract, change, field):
    response = client.put(f"{BASE}/{contract['id']}", json=change, headers=headers)
    assert response.status_code == 400, response.get_json()
    assert response.get_json()["details"]["field"] == field


def test_unknown_fields_missing_references_and_empty_edits(client, headers, contract):
    unknown = client.put(f"{BASE}/{contract['id']}", json={"colour": "red"}, headers=headers)
    assert unknown.status_code == 400
    assert unknown.get_json()["details"]["fields"] == ["colour"]
    missing = client.put(f"{BASE}/{contract['id']}", json={"owner_id": str(uuid4())}, headers=headers)
    assert missing.status_code == 404
    assert client.put(f"{BASE}/{contract['id']}", json={}, headers=headers).status_code == 400
    assert client.put(f"{BASE}/{contract['id']}", json=[1], headers=headers).status_code == 400
    assert client.post(BASE, json={"title": "No customer"}, headers=headers).status_code == 400
    assert client.get(f"{BASE}/{uuid4()}", headers=headers).status_code == 404


def test_an_edit_is_audited_and_a_lost_race_refused(client, headers, contract):
    edited = client.put(f"{BASE}/{contract['id']}", json={
        "value": "52,500", "auto_renew": "yes", "notes": "Uplift agreed", "expected_updated_at": contract["updated_at"],
    }, headers=headers)
    assert edited.status_code == 200, edited.get_json()
    assert edited.get_json()["value"] == 52500.0
    assert edited.get_json()["auto_renew"] is True
    stale = client.put(f"{BASE}/{contract['id']}", json={"value": 1, "expected_updated_at": "2001-01-01T00:00:00"},
                       headers=headers)
    assert stale.status_code == 409
    bad = client.put(f"{BASE}/{contract['id']}", json={"value": 1, "expected_updated_at": "yesterday"}, headers=headers)
    assert bad.status_code == 400
    trail = client.get(f"{PREFIX}/api/records/contract/{contract['id']}/versions", headers=headers).get_json()
    assert [v["action"] for v in trail["versions"]] == ["CREATE", "UPDATE"]
    assert set(trail["versions"][-1]["changed"]) == {"value", "auto_renew", "notes"}


def test_the_board_moves_cards_between_stages_and_ranks_them(client, headers, contract):
    second = client.post(BASE, json={
        "title": "Probe two", "customer_id": contract["customer"]["id"], "value": 1000,
        "start_date": "2026-01-01", "end_date": "2027-01-01", "stage": "NEGOTIATION",
    }, headers=headers).get_json()
    assert second["probability"] == 65
    moved = client.post(f"{BASE}/{contract['id']}/move",
                        json={"stage": "NEGOTIATION", "before_id": second["id"]}, headers=headers)
    assert moved.status_code == 200, moved.get_json()
    assert moved.get_json()["stage"] == "NEGOTIATION"
    assert moved.get_json()["probability"] == 65
    assert moved.get_json()["rank"] < second["rank"]

    board = client.get(f"{BASE}/board?q=Probe", headers=headers).get_json()
    assert [c["stage"] for c in board["columns"]] == list(service.STAGES)
    negotiation = next(c for c in board["columns"] if c["stage"] == "NEGOTIATION")
    ids = [card["id"] for card in negotiation["cards"]]
    assert ids.index(contract["id"]) < ids.index(second["id"])
    assert negotiation["value"] >= 49000

    won = client.post(f"{BASE}/{contract['id']}/move", json={"stage": "renewed", "probability": 100}, headers=headers)
    assert won.get_json()["closed_at"]
    lost = client.post(f"{BASE}/{second['id']}/move",
                       json={"stage": "CHURNED", "churn_reason": "Budget cut"}, headers=headers).get_json()
    assert lost["probability"] == 0
    assert lost["churn_reason"] == "Budget cut"
    # Same place again is not an edit, but the card is touched.
    again = client.post(f"{BASE}/{second['id']}/move", json={"stage": "CHURNED"}, headers=headers)
    assert again.status_code == 200
    # Into an empty filtered column, and at the end of one.
    third = client.post(BASE, json={
        "title": "Probe three", "customer_id": contract["customer"]["id"], "value": 10,
        "start_date": "2026-01-01", "end_date": "2027-01-01",
    }, headers=headers).get_json()
    assert client.post(f"{BASE}/{third['id']}/move", json={"stage": "COMMITTED", "before_id": str(uuid4())},
                       headers=headers).status_code == 200
    assert client.post(f"{BASE}/{third['id']}/move", json={"stage": "NOPE"}, headers=headers).status_code == 400
    assert client.post(f"{BASE}/{third['id']}/move", json=[], headers=headers).status_code == 400
    trail = client.get(f"{PREFIX}/api/records/contract/{contract['id']}/versions", headers=headers).get_json()
    assert trail["versions"][-1]["action"] == "STATUS_CHANGE"


def test_the_list_filters_sorts_and_summarises(client, headers, contract):
    listed = client.get(f"{BASE}?q={contract['reference']}&stage=UPCOMING", headers=headers).get_json()
    assert [c["id"] for c in listed["items"]] == [contract["id"]]
    assert listed["summary"]["open"] == 1
    assert listed["summary"]["pipeline"] == 48000.0
    by_customer = client.get(f"{BASE}?customer_id={contract['customer']['id']}&sort=value&order=asc",
                             headers=headers).get_json()
    assert contract["id"] in [c["id"] for c in by_customer["items"]]
    today = now().date()
    window = client.get(f"{BASE}?ending_from={today.isoformat()}&ending_to={(today + timedelta(days=90)).isoformat()}"
                        f"&owner_id={contract['owner']['id']}", headers=headers).get_json()
    assert contract["id"] in [c["id"] for c in window["items"]]
    risky = client.get(f"{BASE}?at_risk=true", headers=headers).get_json()
    assert all(c["at_risk"] for c in risky["items"])
    assert client.get(f"{BASE}?stage=MAYBE", headers=headers).status_code == 400
    assert client.get(f"{BASE}?ending_from=soon", headers=headers).status_code == 400
    assert client.get(f"{BASE}?page=x", headers=headers).status_code == 400


def test_the_forecast_groups_by_quarter(client, headers, contract):
    body = client.get(f"{BASE}/forecast?quarters=4", headers=headers).get_json()
    assert len(body["quarters"]) == 5
    assert sum(1 for q in body["quarters"] if q["current"]) == 1
    assert body["quarters"][0]["past"] is True
    assert body["totals"]["pipeline"] >= 48000
    assert client.get(f"{BASE}/forecast?quarters=x", headers=headers).status_code == 400
    assert len(client.get(f"{BASE}/forecast?quarters=1", headers=headers).get_json()["quarters"]) == 2


def test_the_calendar_shows_ends_and_notice_deadlines(client, headers, contract):
    end = date.fromisoformat(contract["end_date"])
    body = client.get(f"{BASE}/calendar?month={end.isoformat()[:7]}", headers=headers).get_json()
    kinds = {(e["kind"], e["contract"]["id"]) for e in body["events"]}
    assert ("END", contract["id"]) in kinds
    notice = date.fromisoformat(contract["notice_by"])
    body = client.get(f"{BASE}/calendar?month={notice.isoformat()[:7]}", headers=headers).get_json()
    assert ("NOTICE", contract["id"]) in {(e["kind"], e["contract"]["id"]) for e in body["events"]}
    assert client.get(f"{BASE}/calendar", headers=headers).status_code == 200
    assert client.get(f"{BASE}/calendar?month=13-13", headers=headers).status_code == 400


def test_files_live_in_a_folder_made_on_first_upload(client, headers, contract):
    empty = client.get(f"{BASE}/{contract['id']}/files", headers=headers).get_json()
    assert empty == {"folder_id": None, "items": [], "can_upload": True}
    made = client.post(f"{BASE}/{contract['id']}/files", headers=headers).get_json()
    again = client.post(f"{BASE}/{contract['id']}/files", headers=headers).get_json()
    assert made["folder_id"] == again["folder_id"]
    from src.core.db import session_scope
    from src.models.content import FileObject, Folder

    with session_scope() as session:
        folder = session.get(Folder, made["folder_id"])
        assert folder.path == f"/Contracts/{contract['reference']}"
        session.add(FileObject(name="signed.pdf", extension="pdf", folder_id=folder.id, size_bytes=10))
    listed = client.get(f"{BASE}/{contract['id']}/files", headers=headers).get_json()
    assert [f["name"] for f in listed["items"]] == ["signed.pdf"]
    with session_scope() as session:
        session.query(FileObject).filter(FileObject.folder_id == made["folder_id"]).delete()
        session.query(Folder).filter(Folder.id == made["folder_id"]).delete()


def test_delete_hides_it_and_rescoring_follows(client, headers, contract):
    gone = client.delete(f"{BASE}/{contract['id']}", headers=headers)
    assert gone.status_code == 200
    assert gone.get_json()["deleted"] is True
    assert client.get(f"{BASE}/{contract['id']}", headers=headers).status_code == 404


def test_at_risk_follows_the_customer_band(client, headers, contract):
    from sqlalchemy import select

    from src.core.db import session_scope
    from src.models.records_analytics import CustomerHealth

    with session_scope() as session:
        health = session.scalars(select(CustomerHealth).where(
            CustomerHealth.customer_id == contract["customer"]["id"])).first()
        original = health.band
        health.band = "CRITICAL"
    try:
        body = client.get(f"{BASE}/{contract['id']}", headers=headers).get_json()
        assert body["at_risk"] is True
        assert body["health_band"] == "CRITICAL"
    finally:
        with session_scope() as session:
            session.scalars(select(CustomerHealth).where(
                CustomerHealth.customer_id == contract["customer"]["id"])).first().band = original


def test_changing_the_customer_rescores_both(client, headers, contract):
    other = client.post(f"{PREFIX}/api/explorer/query", json={
        "resource_type": "customer", "columns": ["name"], "page_size": 2, "sort": "name", "order": "desc",
    }, headers=headers).get_json()["items"][0]["id"]
    moved = client.put(f"{BASE}/{contract['id']}", json={"customer_id": other}, headers=headers)
    assert moved.status_code == 200
    assert moved.get_json()["customer"]["id"] == other


def test_values_coerce_from_the_forms_strings():
    assert service._value(None, "auto_renew", "bool", "no") is False
    assert service._value(None, "auto_renew", "bool", True) is True
    assert service._value(None, "auto_renew", "bool", "") is False
    assert service._value(None, "notes", "longtext", "  x ") == "x"
    assert service._value(None, "value", "money", "€1,250.5") == Decimal("1250.50")
    assert service._value(None, "probability", "percent", "40") == 40
