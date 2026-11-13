"""Insights (§43): a question, a page composed from the registry, data bound as the viewer.

The model is always the deterministic fake here — scripted where a test is
about what the model said, unscripted where it is about the planner that runs
without one. No test reaches the gateway.
"""

from __future__ import annotations

import json

import pytest

from src.config import Config
from src.core import llm
from src.services import insight_spec as specs
from src.services import insight_suggestions as suggestions
from tests.conftest import persona_claims

PREFIX = Config.API_PREFIX
API = f"{PREFIX}/api/insights"


def _as(monkeypatch, username: str = "admin", role: str = "administrator"):
    monkeypatch.setattr("src.core.auth.tokens.verify_token",
                        lambda _token: persona_claims(username, role, sid=f"in-{username}"))
    return {"Authorization": f"Bearer in-{username}"}


@pytest.fixture()
def fake_ai():
    llm.set_client(llm.FakeClient())
    yield
    llm.set_client(None)


SPEC = {
    "title": "Orders by channel",
    "summary": "Where orders come from.",
    "blocks": [
        {"type": "kpi", "label": "Orders", "query": {"dataset": "order", "measures": ["count"]}},
        {"type": "bar", "title": "By channel", "query": {"dataset": "order", "dimensions": ["channel"]}},
        {"type": "hologram", "title": "Unknown"},
        {"type": "markdown", "text": "**Phone** leads."},
    ],
}


@pytest.mark.database
def test_without_a_model_the_planner_composes_a_page_for_the_dataset_named(client, monkeypatch, fake_ai):
    headers = _as(monkeypatch)
    draft = client.post(f"{API}/generate", json={"question": "How are support tickets doing?"}, headers=headers)
    assert draft.status_code == 200, draft.get_json()
    body = draft.get_json()
    assert body["source"] == "fallback" and body["id"] is None
    assert body["title"] == "Support at a glance"
    kinds = [node["type"] for node in body["rendered"]["blocks"]]
    assert "kpi" in kinds and "line" in kinds
    first = body["rendered"]["blocks"][0]
    assert isinstance(first["data"]["value"], (int, float))


@pytest.mark.database
def test_the_model_looks_with_tools_then_answers_with_a_spec(client, monkeypatch, fake_ai):
    headers = _as(monkeypatch)
    look = llm.ChatResult(text="", tool_calls=[
        llm.ToolCall("c1", "run_analysis", {"dataset": "order", "dimensions": ["channel"]}),
        llm.ToolCall("c2", "list_records", {"dataset": "order", "limit": 3}),
        llm.ToolCall("c3", "run_analysis", {"dataset": "nope"}),
        llm.ToolCall("c4", "draw_unicorn", {}),
    ])
    script = llm.FakeClient(script=[look, json.dumps(SPEC)])
    llm.set_client(script)
    body = client.post(f"{API}/generate", json={"question": "Where do orders come from?"}, headers=headers).get_json()
    assert body["source"] == "ai"
    assert [n["type"] for n in body["rendered"]["blocks"]] == ["kpi", "bar", "markdown"]
    assert any("hologram" in w for w in body["warnings"])
    bar = body["rendered"]["blocks"][1]["data"]
    assert len(bar["categories"]) == len(bar["series"][0]["values"]) > 0
    # The tool results went back to the model, errors included.
    tool_messages = [m for m in script.calls[1]["messages"] if m["role"] == "tool"]
    assert len(tool_messages) == 4
    assert "error" in tool_messages[2]["content"] and "unknown tool" in tool_messages[3]["content"]


@pytest.mark.database
def test_an_unusable_model_answer_falls_back_to_the_planner(client, monkeypatch, fake_ai):
    headers = _as(monkeypatch)
    llm.set_client(llm.FakeClient(script=['{"title": "x", "blocks": [{"type": "nonsense"}]}']))
    body = client.post(f"{API}/generate", json={"question": "device battery"}, headers=headers).get_json()
    assert body["source"] == "fallback" and body["title"] == "Fleet health"
    assert any("could not be used" in w for w in body["warnings"])

    class Down(llm.FakeClient):
        def chat(self, *args, **kwargs):
            raise llm.LlmError("LLM_TIMEOUT", "slow", retryable=True)

    llm.set_client(Down(script=["x"]))
    body = client.post(f"{API}/generate", json={"question": "project budget"}, headers=headers).get_json()
    assert body["source"] == "fallback" and any("not available" in w for w in body["warnings"])

    class Busy(Down):
        def chat(self, *args, **kwargs):
            raise llm.LlmError("LLM_BUSY", "busy", retryable=True)

    llm.set_client(Busy(script=["x"]))
    assert client.post(f"{API}/generate", json={"question": "orders"}, headers=headers).status_code == 503


@pytest.mark.database
def test_a_model_that_keeps_calling_tools_is_asked_for_the_page(client, monkeypatch, fake_ai):
    headers = _as(monkeypatch)
    look = llm.ChatResult(text="", tool_calls=[llm.ToolCall("c", "run_analysis", {"dataset": "order"})])
    script = llm.FakeClient(script=[look, look, look, "```json\n" + json.dumps(SPEC) + "\n```"])
    llm.set_client(script)
    body = client.post(f"{API}/generate", json={"question": "orders"}, headers=headers).get_json()
    assert body["source"] == "ai" and len(script.calls) == 4
    assert script.calls[-1]["json_mode"] is True


@pytest.mark.database
def test_suggestions_save_pin_share_refresh_and_remove(client, monkeypatch, fake_ai):
    headers = _as(monkeypatch)
    listing = client.get(API, headers=headers).get_json()
    keys = [s["key"] for s in listing["suggestions"]]
    assert "order-1" in keys and listing["datasets"]
    draft = client.post(f"{API}/suggestions/order-1", headers=headers).get_json()
    assert draft["source"] == "suggested" and draft["title"] == "Sales this year"
    revenue = draft["rendered"]["blocks"][0]
    assert "delta" in revenue["data"] or "previous" in revenue["data"]
    assert client.post(f"{API}/suggestions/order-99", headers=headers).status_code == 404

    saved = client.post(API, json={**draft, "scope": "PUBLIC"}, headers=headers)
    assert saved.status_code == 201, saved.get_json()
    insight = saved.get_json()
    assert insight["id"] and insight["scope"] == "PUBLIC" and insight["datasets"] == ["order"]
    assert insight["rendered"]["blocks"][3]["data"]["categories"]

    pinned = client.put(f"{API}/{insight['id']}", json={"pinned": True, "title": "Sales"}, headers=headers).get_json()
    assert pinned["pinned"] is True and pinned["title"] == "Sales" and pinned["spec"]["title"] == "Sales"
    first = client.get(API, headers=headers).get_json()["items"][0]
    assert first["id"] == insight["id"]

    refreshed = client.post(f"{API}/{insight['id']}/refresh", headers=headers).get_json()
    assert refreshed["refreshed_at"] >= insight["refreshed_at"]
    fresh = client.get(f"{API}/{insight['id']}?fresh=true", headers=headers).get_json()
    assert fresh["rendered"]["blocks"][0]["data"]

    # Somebody else sees a public insight with *their* numbers, and cannot change it.
    other = _as(monkeypatch, "analyst", "analyst")
    assert insight["id"] in [i["id"] for i in client.get(API, headers=other).get_json()["items"]]
    theirs = client.post(f"{API}/{insight['id']}/refresh", headers=other).get_json()
    assert theirs["rendered"]["blocks"][0]["data"]
    assert client.put(f"{API}/{insight['id']}", json={"title": "x"}, headers=other).status_code == 403
    assert client.delete(f"{API}/{insight['id']}", headers=other).status_code == 403

    headers = _as(monkeypatch)
    private = client.put(f"{API}/{insight['id']}", json={"scope": "SHARED", "member_ids": []}, headers=headers)
    assert private.get_json()["scope"] == "SHARED"
    other = _as(monkeypatch, "analyst", "analyst")
    assert client.get(f"{API}/{insight['id']}", headers=other).status_code == 404

    headers = _as(monkeypatch)
    mine = client.get(f"{API}?scope=mine&q=Sales", headers=headers).get_json()
    assert insight["id"] in [i["id"] for i in mine["items"]]
    assert client.delete(f"{API}/{insight['id']}", headers=headers).get_json()["deleted"] is True
    assert client.get(f"{API}/{insight['id']}", headers=headers).status_code == 404


@pytest.mark.database
def test_a_query_the_viewer_may_not_run_is_that_component_s_error(client, monkeypatch, fake_ai):
    headers = _as(monkeypatch)
    spec = {"title": "Mixed", "blocks": [
        {"type": "kpi", "label": "Bad field", "query": {"dataset": "order", "measures": [{"aggregation": "sum", "field": "nope"}]}},
        {"type": "table", "title": "Unknown dataset", "records": {"dataset": "spaceships"}},
        {"type": "callout", "tone": "warning", "title": "Note", "text": "Kept."},
    ]}
    saved = client.post(API, json={"question": "q", "spec": spec}, headers=headers).get_json()
    blocks = saved["rendered"]["blocks"]
    assert blocks[0]["error"] and blocks[1]["error"] and "error" not in blocks[2]
    assert len(saved["warnings"]) == 2


@pytest.mark.database
def test_validation(client, monkeypatch, fake_ai):
    headers = _as(monkeypatch)
    assert client.post(f"{API}/generate", json={"question": ""}, headers=headers).status_code == 400
    assert client.post(f"{API}/generate", json={"question": "x" * 600}, headers=headers).status_code == 400
    assert client.post(API, json={"question": "", "spec": SPEC}, headers=headers).status_code == 400
    assert client.post(API, json={"question": "q", "spec": {"blocks": []}}, headers=headers).status_code == 400
    saved = client.post(API, json={"question": "q", "spec": SPEC}, headers=headers).get_json()
    assert client.put(f"{API}/{saved['id']}", json={"title": " "}, headers=headers).status_code == 400


# ── the registry, without a database ─────────────────────────────────────


def test_validation_keeps_only_what_the_registry_knows():
    spec, warnings = specs.validate({
        "title": "T" * 300,
        "blocks": [
            {"type": "KPI", "label": "Value", "value": 42, "format": "currency", "width": "half", "evil": "<script>"},
            {"type": "kpi", "label": "Nothing"},
            {"type": "markdown", "text": ""},
            "not a node",
            {"type": "section", "title": "S", "blocks": [
                {"type": "callout", "tone": "loud", "text": "t"},
                {"type": "section", "blocks": [{"type": "markdown", "text": "deep"}]},
            ]},
            {"type": "comparison", "title": "C", "items": [{"label": "A", "value": 1}, "x"]},
            {"type": "timeline", "title": "T", "events": [{"date": "2026-01-01", "title": "Start", "tone": "nope"}]},
            {"type": "list", "title": "L", "items": [{"title": "One", "value": True}]},
            {"type": "progress", "label": "P", "value": 3, "max": 10},
            {"type": "line", "query": {"dataset": "order", "dimensions": "placed_at", "measures": "count",
                                       "limit": 999, "filters": {"status": "DELIVERED"}, "period": "last_30_days"}},
            {"type": "table", "records": {"dataset": "order", "columns": ["reference"], "limit": 500, "order": "asc"}},
        ],
    })
    assert len(spec["title"]) == 200
    kpi = spec["blocks"][0]
    assert kpi == {"type": "kpi", "width": "half", "label": "Value", "value": 42, "format": "currency"}
    section = spec["blocks"][1]
    assert section["blocks"][0]["tone"] == "info" and len(section["blocks"]) == 1
    assert spec["blocks"][2]["data"]["items"] == [{"label": "A", "value": 1}]
    assert spec["blocks"][3]["data"]["events"][0]["tone"] is None
    assert spec["blocks"][4]["data"]["items"][0]["value"] is None
    line = spec["blocks"][6]["query"]
    assert line["dimensions"] == ["placed_at"] and line["limit"] == 50
    assert spec["blocks"][7]["records"]["limit"] == 20 and spec["blocks"][7]["records"]["order"] == "asc"
    assert any("no data" in w for w in warnings) and any("do not nest" in w for w in warnings)
    assert any("not a component" in w for w in warnings)
    assert specs.queries_of(spec) == ["order"]


def test_a_spec_with_nothing_usable_is_refused():
    with pytest.raises(specs.SpecError):
        specs.validate("nope")
    with pytest.raises(specs.SpecError):
        specs.validate({"blocks": [{"type": "nope"}]})


def test_too_many_components_are_cut():
    spec, warnings = specs.validate({"blocks": [{"type": "markdown", "text": str(i)} for i in range(40)]})
    assert len(spec["blocks"]) == specs.MAX_NODES and warnings


def test_every_suggestion_is_a_valid_spec():
    for dataset, items in suggestions.SUGGESTIONS.items():
        for item in items:
            spec, warnings = specs.validate(item["spec"])
            assert not warnings, (dataset, warnings)
            assert set(specs.queries_of(spec)) == {dataset}
    assert suggestions.find("order-x") is None and suggestions.find("nothing") is None


@pytest.mark.database
def test_every_component_binds_its_query(client, monkeypatch, fake_ai):
    headers = _as(monkeypatch)
    spec = {"title": "All of them", "blocks": [
        {"type": "progress", "label": "Delivered", "max": 1000,
         "query": {"dataset": "order", "measures": ["count"], "filters": {"status": "DELIVERED"}}},
        {"type": "comparison", "title": "By channel", "query": {"dataset": "order", "dimensions": ["channel"]}},
        {"type": "list", "title": "Top channels", "query": {"dataset": "order", "dimensions": ["channel"]}},
        {"type": "timeline", "title": "Per month", "query": {"dataset": "order",
                                                             "dimensions": [{"field": "placed_at", "granularity": "month"}],
                                                             "period": "last_180_days"}},
        {"type": "timeline", "title": "Latest", "records": {"dataset": "order", "sort": "placed_at",
                                                            "date_field": "placed_at", "limit": 3}},
        {"type": "list", "title": "Customers", "records": {"dataset": "customer", "limit": 3}},
        {"type": "table", "title": "Grouped", "query": {"dataset": "order", "dimensions": ["status"],
                                                       "measures": ["count", {"aggregation": "sum", "field": "total"}]}},
        {"type": "bar", "title": "Two dimensions", "query": {"dataset": "order", "dimensions": ["channel", "status"]}},
        {"type": "pie", "title": "Long tail", "query": {"dataset": "customer", "dimensions": ["city"], "limit": 3}},
    ]}
    saved = client.post(API, json={"question": "everything", "spec": spec}, headers=headers).get_json()
    blocks = saved["rendered"]["blocks"]
    assert not [b for b in blocks if "error" in b], [b.get("error") for b in blocks]
    progress, comparison, top, months, latest, customers, grouped, stacked, tail = (b["data"] for b in blocks)
    assert isinstance(progress["value"], int)
    assert comparison["items"] and top["items"][0]["title"]
    assert months["events"] and latest["events"][0]["href"].startswith("/orders/")
    assert customers["items"][0]["href"].startswith("/customers/")
    assert [c["label"] for c in grouped["columns"]][0] == "Status" and grouped["rows"]
    assert len(stacked["series"]) > 1
    assert tail["categories"][-1] == "Other"
