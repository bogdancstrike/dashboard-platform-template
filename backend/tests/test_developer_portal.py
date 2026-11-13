"""The developer portal (§31) and calling the API with a client's key.

Worth asserting: the reference is *read from the platform* (every mapped route,
the guard the code really checks, a real captured example); a key authenticates
as its client's owner with no more than both grant, and every refusal says why;
each keyed request is counted, and the usage charts are computed from those rows.
"""

from __future__ import annotations

import uuid
from datetime import timedelta

import pytest
from sqlalchemy import select

from src.config import Config
from src.core.clock import now
from src.core.db import session_scope
from src.services import developer_portal as portal
from tests.conftest import persona_claims

PREFIX = Config.API_PREFIX
CLIENTS = f"{PREFIX}/admin/api-clients"
DEV = f"{PREFIX}/api/developers"


def _auth(monkeypatch, username: str = "admin", role: str = "administrator"):
    monkeypatch.setattr("src.core.auth.verify_token",
                        lambda _token: persona_claims(username, role, sid=f"dev-{username}"))
    return {"Authorization": f"Bearer dev-{username}"}


def _client(client, headers, **extra) -> dict:
    body = {"name": f"Portal test {uuid.uuid4().hex[:6]}", "scopes": ["records.view"], **extra}
    answer = client.post(CLIENTS, headers=headers, json=body)
    assert answer.status_code == 201, answer.get_json()
    return answer.get_json()


# ── pure helpers ─────────────────────────────────────────────────────────


def test_a_sample_is_cut_down_and_a_schema_inferred():
    value = {"items": [{"id": "11111111-1111-1111-1111-111111111111", "at": "2026-11-13T04:00:00Z",
                        "n": 1, "x": 1.5, "ok": True, "none": None, "long": "y" * 500}] * 5,
             "deep": {"a": {"b": {"c": {"d": {"e": {"f": 1}}}}}}}
    cut = portal.sample(value)
    assert len(cut["items"]) == portal.SAMPLE_ITEMS
    assert cut["items"][0]["long"].endswith("…")
    assert cut["deep"]["a"]["b"]["c"]["d"]["e"] == "…"
    schema = portal.infer_schema(value)
    item = schema["properties"]["items"]["items"]["properties"]
    assert item["id"] == {"type": "string", "format": "uuid"}
    assert item["at"]["format"] == "date-time"
    assert item["n"] == {"type": "integer"} and item["x"] == {"type": "number"}
    assert item["ok"] == {"type": "boolean"} and item["none"] == {"type": "null"}
    assert portal.infer_schema([]) == {"type": "array", "items": {}}
    assert portal.infer_schema(object()) == {}


def test_groups_are_named_by_the_route():
    assert portal._group("/api/automations/rules") == "automations"
    assert portal._group("/public/forms/<slug>") == "public-forms"
    assert portal._group("/health/live") == "health"
    assert portal._group("/") == "platform"


def test_the_guard_is_read_off_the_handler():
    assert portal._guard("src.api.workflows", "rules") == {
        "access": "permission", "permissions": ["automations.manage"],
        "doc": "Every automation, or a new one."}
    assert portal._guard("src.api.developers", "reference")["access"] == "authenticated"
    assert portal._guard("src.api.forms", "public_form")["access"] == "public"
    assert portal._guard("src.api.workflows", "hook")["access"] == "public"
    assert portal._guard("src.api.nothing", "x")["access"] == "unknown"


# ── the reference ────────────────────────────────────────────────────────


@pytest.mark.database
def test_the_reference_lists_every_mapped_route_with_its_guard(client, monkeypatch):
    from src.api import endpoint_map

    headers = _auth(monkeypatch, "user", "user")
    body = client.get(f"{DEV}/reference", headers=headers).get_json()
    expected = sum(len(e.get("request_method") or ["GET"]) for e in endpoint_map.load()["endpoints"])
    assert body["total"] == expected
    groups = {group["key"]: group for group in body["groups"]}
    rules = next(e for e in groups["automations"]["endpoints"] if e["id"] == "GET /api/automations/rules")
    assert rules["permissions"] == ["automations.manage"] and rules["allowed"] is False
    graph = next(e for e in groups["automations"]["endpoints"] if e["route"].endswith("/graph") and e["method"] == "PUT")
    assert graph["parameters"] == [{"name": "rule_id", "in": "path", "type": "uuid"}] and graph["body"] is True
    assert body["can_capture"] is False and body["changelog"][0]["version"]
    assert client.get(f"{DEV}/reference").status_code == 401


@pytest.mark.database
def test_a_console_call_is_kept_as_the_routes_example(client, monkeypatch):
    headers = _auth(monkeypatch)
    response = {"items": [{"id": "11111111-1111-1111-1111-111111111111", "name": "x"}], "total": 1}
    kept = client.post(f"{DEV}/examples", headers=headers, json={
        "method": "GET", "route": "/api/automations/rules", "status_code": 200,
        "path": "/platform/api/automations/rules?state=ENABLED", "response": response, "duration_ms": 42,
    })
    assert kept.status_code == 201, kept.get_json()
    again = client.post(f"{DEV}/examples", headers=headers, json={
        "method": "GET", "route": "/api/automations/rules", "status_code": 200, "response": response,
        "request_body": {"a": 1}})
    assert again.status_code == 201
    body = client.get(f"{DEV}/reference", headers=headers).get_json()
    rules = next(e for g in body["groups"] for e in g["endpoints"] if e["id"] == "GET /api/automations/rules")
    assert rules["example"]["schema"]["properties"]["total"] == {"type": "integer"}
    assert body["documented"] >= 1

    for bad in ({"method": "GET", "route": "/nope"},
                {"method": "GET", "route": "/api/automations/rules", "status_code": 404},
                {"method": "GET", "route": "/api/automations/rules", "status_code": "x"}):
        assert client.post(f"{DEV}/examples", headers=headers, json=bad).status_code == 400
    viewer = _auth(monkeypatch, "user", "user")
    assert client.post(f"{DEV}/examples", headers=viewer, json={}).status_code == 403


# ── keys ─────────────────────────────────────────────────────────────────


@pytest.mark.database
def test_a_key_acts_as_its_owner_with_only_its_scopes_and_is_counted(client, monkeypatch):
    from src.models.platform import ApiRequestLog

    admin = _auth(monkeypatch)
    made = _client(client, admin, scopes=["records.view"])
    key = {"X-Api-Key": made["secret"]}
    me = client.get(f"{PREFIX}/api/me", headers=key)
    assert me.status_code == 200, me.get_json()
    # It acts as the person who made the client…
    assert me.get_json()["user"]["username"] == "admin"
    # …and records are readable, because both the owner and the scope allow it.
    assert client.get(f"{PREFIX}/api/explorer/catalog", headers=key).status_code == 200
    # Beyond the scopes: refused, though the owner may.
    assert client.get(f"{PREFIX}/api/automations/rules", headers=key).status_code == 403
    with session_scope() as session:
        rows = session.scalars(select(ApiRequestLog).where(ApiRequestLog.api_client_id == made["id"])).all()
        assert {row.status_code for row in rows} == {200, 403} and len(rows) == 3
        assert any(row.path == "/platform/api/me" for row in rows)

    usage = client.get(f"{DEV}/usage?client={made['id']}&days=7", headers=admin).get_json()
    assert usage["totals"]["requests"] == 3 and usage["totals"]["errors"] == 1
    assert usage["top_endpoints"] and usage["series"][0]["requests"] == 3
    assert {c["code"] for c in usage["status_codes"]} == {200, 403}
    overall = client.get(f"{DEV}/usage", headers=admin).get_json()
    assert any(c["id"] == made["id"] and c["requests"] == 3 for c in overall["clients"])
    assert client.get(f"{DEV}/usage?days=x", headers=admin).status_code == 400
    assert client.get(f"{DEV}/usage?client={uuid.uuid4()}", headers=admin).status_code == 404
    assert client.get(f"{DEV}/usage", headers=_auth(monkeypatch, "user", "user")).status_code == 403


@pytest.mark.database
def test_a_key_that_cannot_be_used_says_why(client, monkeypatch):
    from src.models.platform import ApiClient, ApiCredential

    admin = _auth(monkeypatch)
    assert client.get(f"{PREFIX}/api/me", headers={"X-Api-Key": "nope"}).status_code == 401
    assert client.get(f"{PREFIX}/api/me", headers={"X-Api-Key": "nuc_" + "x" * 40}).status_code == 401

    made = _client(client, admin)
    key = {"X-Api-Key": made["secret"]}
    credential_id = made["credential"]["id"]

    def edit(**changes):
        with session_scope() as session:
            credential = session.get(ApiCredential, credential_id)
            api_client = session.get(ApiClient, made["id"])
            for name, value in changes.items():
                setattr(credential if name in ("expires_at", "revoked_at") else api_client, name, value)

    edit(expires_at=now() - timedelta(minutes=1))
    assert "expired" in client.get(f"{PREFIX}/api/me", headers=key).get_json()["message"]
    edit(expires_at=None, revoked_at=now())
    assert "revoked" in client.get(f"{PREFIX}/api/me", headers=key).get_json()["message"]
    edit(revoked_at=None, status="SUSPENDED")
    assert "not active" in client.get(f"{PREFIX}/api/me", headers=key).get_json()["message"]
    edit(status="ACTIVE", allowed_ips=["10.9.9.9"])
    assert client.get(f"{PREFIX}/api/me", headers=key).status_code == 403
    edit(allowed_ips=None, rate_limit_per_minute=1)
    assert client.get(f"{PREFIX}/api/me", headers=key).status_code == 200
    assert client.get(f"{PREFIX}/api/me", headers=key).status_code == 429


@pytest.mark.database
def test_the_seed_adds_real_examples_and_tops_up_thin_usage(monkeypatch):
    from src.seed import developers as seed

    with session_scope() as session:
        first = seed.populate(session)
        assert set(first) == {"examples", "usage_rows"}
        assert seed.populate(session)["examples"] == 0
        # A thin window is topped up; a full one is left alone.
        monkeypatch.setattr(seed, "THIN", 10**9)
        assert seed._usage(session) > 0
        monkeypatch.setattr(seed, "THIN", 0)
        assert seed._usage(session) == 0
        session.rollback()
