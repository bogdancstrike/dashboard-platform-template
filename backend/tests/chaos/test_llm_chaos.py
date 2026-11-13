"""LiteLLM refused, hung, slow or trickling: AI features say "unavailable", fast.

Real money is on the other side of this gateway, so the contract is strict:
no model call outlives `LLM_MAX_SECONDS` (3 s in the test/load profiles), a
failure is a 503 envelope (`services/ai.unavailable`), and nothing becomes a
500. The unit tests in `test_llm_client.py` fake the HTTP session; these put a
real socket on the other end — a closed port, a black hole, an HTTP server that
answers late, and one that streams a token every 300 ms forever.
"""

from __future__ import annotations

import pytest

from src.config import Config
from src.core import llm
from tests.chaos.conftest import REFUSED_HOST, REFUSED_PORT, Stopwatch
from tests.conftest import persona_claims

CAP = 1.0
MESSAGES = [{"role": "user", "content": "hello"}]


@pytest.fixture(autouse=True)
def short_cap(monkeypatch):
    monkeypatch.setattr(Config, "LLM_MAX_SECONDS", CAP)
    yield
    llm.set_client(None)


def _gateway(url: str) -> llm.GatewayClient:
    return llm.GatewayClient(base_url=f"{url}/v1", api_key="sk-chaos", model="chaos")


def test_refused_gateway_is_unavailable_at_once():
    with Stopwatch() as watch, pytest.raises(llm.LlmError) as raised:
        _gateway(f"http://{REFUSED_HOST}:{REFUSED_PORT}").chat(MESSAGES)
    assert raised.value.code == "LLM_UNAVAILABLE"
    assert watch.seconds < CAP + 0.5


def test_hung_gateway_times_out_at_the_cap(black_hole):
    with Stopwatch() as watch, pytest.raises(llm.LlmError) as raised:
        _gateway(f"http://127.0.0.1:{black_hole.port}").chat(MESSAGES)
    assert raised.value.code == "LLM_TIMEOUT"
    assert watch.seconds < CAP + 1.0, f"held for {watch.seconds:.2f}s against a cap of {CAP}s"


def test_slow_answer_is_abandoned_at_the_cap(slow_http):
    server = slow_http(5.0, body=b'{"choices":[{"message":{"content":"late"}}]}')
    with Stopwatch() as watch, pytest.raises(llm.LlmError) as raised:
        _gateway(server.url).chat(MESSAGES)
    assert raised.value.code == "LLM_TIMEOUT"
    assert watch.seconds < CAP + 1.0


def test_a_trickling_stream_stops_at_the_cap(slow_http):
    """A stream that never finishes never trips a read timeout — the total cap must."""
    server = slow_http(0.3, trickle=True)
    received = []
    with Stopwatch() as watch, pytest.raises(llm.LlmError) as raised:
        for event in _gateway(server.url).stream(MESSAGES):
            received.append(event)
    assert raised.value.code == "LLM_TIMEOUT"
    assert received, "it did stream before the cap"
    assert watch.seconds < CAP + 1.0, f"streamed for {watch.seconds:.2f}s against a cap of {CAP}s"


def test_embeddings_are_capped_too(slow_http):
    server = slow_http(5.0)
    with Stopwatch() as watch, pytest.raises(llm.LlmError):
        _gateway(server.url).embed(["a"])
    assert watch.seconds < CAP + 1.0


def test_a_fast_gateway_is_untouched_by_the_cap(slow_http):
    server = slow_http(0.05, body=b'{"choices":[{"message":{"content":"ok"}}],"usage":{"prompt_tokens":3}}')
    assert _gateway(server.url).chat(MESSAGES).text == "ok"


@pytest.mark.database
@pytest.mark.parametrize("kind", ["refused", "hung"])
def test_ai_endpoints_answer_503_within_the_cap(client, monkeypatch, black_hole, kind):
    """End to end: the AI endpoints turn a gateway outage into a clean answer."""
    url = f"http://{REFUSED_HOST}:{REFUSED_PORT}" if kind == "refused" else f"http://127.0.0.1:{black_hole.port}"
    llm.set_client(_gateway(url))
    monkeypatch.setattr("src.core.auth.tokens.verify_token", lambda _t: persona_claims("user", "user", sid="chaos-llm"))
    headers = {"Authorization": "Bearer chaos"}
    prefix = Config.API_PREFIX
    with Stopwatch() as watch:
        help_answer = client.post(f"{prefix}/api/assistant/page-help", headers=headers,
                                  json={"question": "how do I export?", "path": "/tickets"})
        filters = client.post(f"{prefix}/api/assistant/filters", headers=headers,
                              json={"resource_type": "ticket", "question": "open critical tickets"})
    for response in (help_answer, filters):
        if response.status_code == 404:
            pytest.skip("the assistant endpoints are not mounted in this build")
        # Either a clean "unavailable" or the feature's own non-AI fallback —
        # never a 500, never a hang.
        assert response.status_code in (200, 503), response.get_data(as_text=True)[:300]
        if response.status_code == 503:
            assert response.get_json()["error"] == "service_unavailable"
    assert watch.seconds < 2 * CAP + 2


def test_fake_header_is_refused_unless_enabled(app, monkeypatch):
    """`X-Nucleus-LLM: fake` is a load-test switch; production must opt in."""
    real = _gateway("http://127.0.0.1:9")
    llm.set_client(real)
    monkeypatch.setattr(Config, "LLM_ALLOW_FAKE_HEADER", False)
    with app.test_request_context(headers={llm.FAKE_HEADER: "fake"}):
        assert llm.get_client() is real
    monkeypatch.setattr(Config, "LLM_ALLOW_FAKE_HEADER", True)
    with app.test_request_context(headers={llm.FAKE_HEADER: "fake"}):
        assert llm.get_client().is_fake
