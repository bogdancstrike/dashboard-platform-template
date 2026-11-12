"""The LLM client: request shape, streaming, tool calls, error classes, the fake."""

from __future__ import annotations

import json

import pytest
import requests

from src.core import llm


class _Resp:
    def __init__(self, status=200, body=None, lines=None):
        self.status_code = status
        self._body = body
        self._lines = lines or []
        self.closed = False

    def json(self):
        if isinstance(self._body, Exception):
            raise self._body
        return self._body

    def iter_lines(self, decode_unicode=True):
        for line in self._lines:
            if isinstance(line, Exception):
                raise line
            yield line

    def close(self):
        self.closed = True


class _Session:
    def __init__(self, *responses):
        self.responses = list(responses)
        self.sent: list[dict] = []

    def post(self, url, headers=None, json=None, timeout=None, stream=False):
        self.sent.append({"url": url, "headers": headers, "json": json, "stream": stream})
        r = self.responses.pop(0)
        if isinstance(r, Exception):
            raise r
        return r


def _client(*responses):
    session = _Session(*responses)
    return llm.GatewayClient("http://gw/v1/", "k-secret", "nucleus-chat", reasoning_effort="low",
                             timeout=5, session=session), session


def test_chat_sends_openai_body_and_parses_tool_calls():
    body = {
        "model": "nucleus-chat",
        "choices": [{"finish_reason": "tool_calls", "message": {"content": None, "tool_calls": [
            {"id": "c1", "function": {"name": "count", "arguments": '{"kind":"tasks"}'}},
            {"function": {"name": "bad", "arguments": "{nope"}},
        ]}}],
        "usage": {"prompt_tokens": 10, "completion_tokens": 5, "completion_tokens_details": {"reasoning_tokens": 2},
                  "prompt_tokens_details": {"cached_tokens": 3}},
    }
    client, session = _client(_Resp(body=body))
    tools = [{"type": "function", "function": {"name": "count"}}]
    res = client.chat([{"role": "user", "content": "hi"}], tools, json_mode=True, user=7, max_tokens=99)
    sent = session.sent[0]
    assert sent["url"] == "http://gw/v1/chat/completions"
    assert sent["headers"]["Authorization"] == "Bearer k-secret"
    assert sent["json"]["tools"] == tools
    assert sent["json"]["response_format"] == {"type": "json_object"}
    assert sent["json"]["reasoning_effort"] == "low"
    assert sent["json"]["max_completion_tokens"] == 99
    assert sent["json"]["user"] == "7"
    assert res.finish_reason == "tool_calls"
    assert res.tool_calls[0].arguments == {"kind": "tasks"}
    assert res.tool_calls[1].id == "call_1" and "__invalid_json__" in res.tool_calls[1].arguments
    assert res.usage.total_tokens == 15 and res.usage.reasoning_tokens == 2 and res.usage.cached_tokens == 3
    msg = res.assistant_message()
    assert msg["tool_calls"][0]["function"]["arguments"] == '{"kind":"tasks"}'
    assert "k-secret" not in repr(client)


def test_chat_unreadable_response_is_bad_output():
    client, _ = _client(_Resp(body={"choices": []}))
    with pytest.raises(llm.LlmError) as e:
        client.chat([])
    assert e.value.code == "LLM_BAD_OUTPUT"


@pytest.mark.parametrize(
    "status,code,retry",
    [(429, "LLM_RATE_LIMITED", True), (401, "LLM_AUTH", False), (503, "LLM_UNAVAILABLE", True),
     (400, "LLM_INVALID_REQUEST", False)],
)
def test_http_errors_are_classified(status, code, retry):
    client, _ = _client(_Resp(status=status, body={"error": {"message": "boom"}}))
    with pytest.raises(llm.LlmError) as e:
        client.chat([])
    assert e.value.code == code and e.value.retryable is retry and e.value.status == status


def test_error_without_json_body():
    client, _ = _client(_Resp(status=400, body=ValueError("no json")))
    with pytest.raises(llm.LlmError) as e:
        client.chat([])
    assert e.value.message == "HTTP 400"


@pytest.mark.parametrize("exc,code", [(requests.Timeout(), "LLM_TIMEOUT"), (requests.ConnectionError(), "LLM_UNAVAILABLE")])
def test_transport_errors(exc, code):
    client, _ = _client(exc)
    with pytest.raises(llm.LlmError) as e:
        client.chat([])
    assert e.value.code == code


def _sse(obj):
    return "data: " + json.dumps(obj)


def test_stream_yields_text_tool_calls_and_usage():
    lines = [
        "",
        ": keepalive",
        "data: not-json",
        _sse({"model": "m1", "choices": [{"delta": {"content": "Hel"}}]}),
        _sse({"choices": [{"delta": {"content": "lo"}}]}),
        _sse({"choices": [{"delta": {"tool_calls": [{"index": 0, "id": "t1", "function": {"name": "get_", "arguments": '{"a"'}}]}}]}),
        _sse({"choices": [{"delta": {"tool_calls": [{"index": 0, "function": {"name": "record", "arguments": ':1}'}}]}, "finish_reason": "tool_calls"}]}),
        _sse({"choices": [], "usage": {"prompt_tokens": 4, "completion_tokens": 6}}),
        "data: [DONE]",
        _sse({"choices": [{"delta": {"content": "ignored"}}]}),
    ]
    resp = _Resp(lines=lines)
    client, session = _client(resp)
    events = list(client.stream([{"role": "user", "content": "x"}], [{"type": "function"}], user="u"))
    assert session.sent[0]["stream"] is True and session.sent[0]["json"]["stream_options"] == {"include_usage": True}
    assert [e.delta for e in events if e.kind == "text"] == ["Hel", "lo"]
    call = next(e.call for e in events if e.kind == "tool_call")
    assert call.name == "get_record" and call.arguments == {"a": 1}
    done = events[-1].result
    assert done.text == "Hello" and done.model == "m1" and done.finish_reason == "tool_calls"
    assert done.usage.total_tokens == 10
    assert resp.closed


def test_stream_broken_midway():
    client, _ = _client(_Resp(lines=[_sse({"choices": [{"delta": {"content": "a"}}]}), requests.ConnectionError()]))
    with pytest.raises(llm.LlmError) as e:
        list(client.stream([]))
    assert e.value.code == "LLM_UNAVAILABLE"


def test_embed():
    client, session = _client(_Resp(body={"data": [{"index": 1, "embedding": [2.0]}, {"index": 0, "embedding": [1.0]}]}))
    assert client.embed([]) == []
    assert client.embed(["a", "b"]) == [[1.0], [2.0]]
    assert session.sent[0]["json"]["model"] == client.embedding_model
    bad, _ = _client(_Resp(body={"nope": 1}))
    with pytest.raises(llm.LlmError):
        bad.embed(["a"])


def test_parse_json_variants():
    assert llm.parse_json('```json\n{"a": 1}\n```') == {"a": 1}
    assert llm.parse_json('Here: {"b": 2}') == {"b": 2}
    assert llm.parse_json("[1]") == [1]
    assert llm.ChatResult(text='{"c":3}').json() == {"c": 3}
    with pytest.raises(llm.LlmError):
        llm.parse_json("no json here")


def test_usage_helpers():
    u = llm.usage_from({"prompt_tokens": "x", "completion_tokens": 3})
    assert u.prompt_tokens == 0 and u.completion_tokens == 3
    assert u.add(llm.Usage(1, 1, 1, 1, 1)).to_dict()["total_tokens"] == 5
    assert llm.usage_from(None).total_tokens == 0


def test_fake_rule_calls_first_tool_then_summarises():
    fake = llm.FakeClient()
    tools = [{"type": "function", "function": {"name": "search_records", "parameters": {
        "type": "object", "required": ["entity"],
        "properties": {"query": {"type": "string"}, "limit": {"type": "integer"},
                       "entity": {"type": "string", "enum": ["tasks", "projects"]}}}}}]
    msgs = [{"role": "user", "content": "Which overdue tasks belong to Alice?"}]
    first = fake.chat(msgs, tools)
    assert first.finish_reason == "tool_calls"
    call = first.tool_calls[0]
    assert call.name == "search_records" and call.arguments == {"query": "Which overdue tasks", "limit": 5, "entity": "tasks"}
    msgs += [first.assistant_message(), {"role": "tool", "tool_call_id": call.id, "content": '{"rows": 2}'}]
    second = fake.chat(msgs, tools)
    assert not second.tool_calls and '{"rows": 2}' in second.text
    assert fake.chat([{"role": "user", "content": [{"type": "text", "text": "hey"}]}]).text.startswith("**(fake model)**")
    assert fake.chat([{"role": "user", "content": "x"}], json_mode=True).text == "{}"
    assert len(fake.calls) == 4


def test_fake_script_and_stream():
    fake = llm.FakeClient(script=["scripted text " * 3, lambda m, t: "from callable",
                                  llm.ChatResult(text="", tool_calls=[llm.ToolCall("c", "t", {})])])
    events = list(fake.stream([{"role": "user", "content": "q"}]))
    assert "".join(e.delta for e in events if e.kind == "text") == "scripted text " * 3
    assert events[-1].kind == "done" and events[-1].result.usage.prompt_tokens >= 1
    assert fake.chat([]).text == "from callable"
    events = list(fake.stream([]))
    assert [e.kind for e in events] == ["tool_call", "done"]
    assert len(fake.embed(["alpha beta", "alpha beta"])[0]) == 256
    assert fake.embed(["same"]) == fake.embed(["same"])


def test_selection(monkeypatch):
    llm.set_client(None)
    monkeypatch.setattr(llm.Config, "LLM_MODE", "auto")
    monkeypatch.setattr(llm.Config, "LLM_API_KEY", "")
    assert llm.mode() == "fake"
    assert isinstance(llm.get_client(), llm.FakeClient) and not llm.is_real()
    llm.set_client(None)
    monkeypatch.setattr(llm.Config, "LLM_API_KEY", "k")
    assert llm.mode() == "real"
    assert isinstance(llm.get_client(), llm.GatewayClient) and llm.is_real()
    monkeypatch.setattr(llm.Config, "LLM_MODE", "fake")
    assert llm.mode() == "fake"
    llm.set_client(None)
