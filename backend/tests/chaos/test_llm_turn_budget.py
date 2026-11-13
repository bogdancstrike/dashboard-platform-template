"""One assistant turn has one time budget, however many model calls it makes.

A Data-mode turn can call the model up to six times (five tool rounds and an
answer), each capped at LLM_MAX_SECONDS — so without a turn budget one
question could hold a worker, and spend, six times the cap.
`LLM_TURN_MAX_SECONDS` bounds the whole turn: a round only starts if a whole
call still fits, and a turn that runs out returns what it has with a note.
"""

from __future__ import annotations

import json

import pytest

from src.config import Config
from src.core import llm
from tests.conftest import persona_claims

BASE = f"{Config.API_PREFIX}/api/assistant"


@pytest.fixture(autouse=True)
def _restore_client():
    yield
    llm.set_client(None)


def _auth(monkeypatch):
    monkeypatch.setattr("src.core.auth.tokens.verify_token",
                        lambda _t: persona_claims("analyst", "analyst", sid="chaos-turn"))
    return {"Authorization": "Bearer chaos-turn"}


def _events(response):
    out = []
    for block in response.get_data(as_text=True).split("\n\n"):
        if block.strip():
            lines = dict(line.split(": ", 1) for line in block.splitlines())
            out.append((lines["event"], json.loads(lines["data"])))
    return out


class _Clock:
    """`time.monotonic` for the assistant module, advanced by each model call."""

    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now


def _looping_client(clock: _Clock, seconds_per_call: float, *, fake: bool) -> llm.FakeClient:
    def tool_call(_messages, _tools):
        clock.now += seconds_per_call
        return llm.ChatResult(text="", tool_calls=[llm.ToolCall("c", "global_search", {"text": "acme"})])

    client = llm.FakeClient(script=[tool_call] * 10)
    client.is_fake = fake  # a real-model stand-in: it must pay the per-call cap
    llm.set_client(client)
    return client


def test_the_budget_defaults_to_the_call_cap_in_the_test_profile():
    assert Config.LLM_TURN_MAX_SECONDS == Config.LLM_MAX_SECONDS


@pytest.mark.database
def test_a_real_model_turn_stops_when_another_call_would_not_fit(client, monkeypatch):
    from src.services import assistant as service

    clock = _Clock()
    monkeypatch.setattr(service.time, "monotonic", clock)
    monkeypatch.setattr(Config, "LLM_MAX_SECONDS", 3.0)
    monkeypatch.setattr(Config, "LLM_TURN_MAX_SECONDS", 7.0)
    fake = _looping_client(clock, 2.5, fake=False)
    h = _auth(monkeypatch)
    convo = client.post(f"{BASE}/conversations", json={"mode": "data"}, headers=h).get_json()

    events = _events(client.post(f"{BASE}/conversations/{convo['id']}/messages",
                                 json={"content": "search forever"}, headers=h))
    # 2.5 s per call against 7 s: rounds start at 0, 2.5 (4.5 left ≥ 3); at 5.0
    # only 2 s are left, which a 3 s call does not fit in.
    assert len(fake.calls) == 2
    message = events[-1][1]["message"]
    assert message["content"].endswith(service.TIME_LIMIT_NOTE)
    assert message["steps"][-1]["name"] == "time_limit"
    assert message["status"] == "complete"


@pytest.mark.database
def test_a_fake_model_turn_only_stops_when_the_budget_is_spent(client, monkeypatch):
    from src.services import assistant as service

    clock = _Clock()
    monkeypatch.setattr(service.time, "monotonic", clock)
    monkeypatch.setattr(Config, "LLM_TURN_MAX_SECONDS", 3.0)
    fake = _looping_client(clock, 1.0, fake=True)
    h = _auth(monkeypatch)
    convo = client.post(f"{BASE}/conversations", json={"mode": "data"}, headers=h).get_json()
    events = _events(client.post(f"{BASE}/conversations/{convo['id']}/messages",
                                 json={"content": "search forever"}, headers=h))
    assert len(fake.calls) == 3  # at 0, 1, 2 — at 3 the budget is spent
    assert events[-1][1]["message"]["content"].endswith(service.TIME_LIMIT_NOTE)


@pytest.mark.database
def test_a_quick_turn_is_untouched(client, monkeypatch):
    llm.set_client(llm.FakeClient(script=["A quick answer."]))
    h = _auth(monkeypatch)
    convo = client.post(f"{BASE}/conversations", json={"mode": "data"}, headers=h).get_json()
    events = _events(client.post(f"{BASE}/conversations/{convo['id']}/messages",
                                 json={"content": "hi"}, headers=h))
    assert events[-1][1]["message"]["content"] == "A quick answer."
