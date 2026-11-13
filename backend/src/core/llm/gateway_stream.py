"""Streaming a chat completion from the gateway: server-sent events, under a deadline."""

from __future__ import annotations

import json
import time
from collections.abc import Iterator

import requests

from src.core.llm.limits import _bounded
from src.core.llm.results import (
    ChatResult,
    LlmError,
    StreamEvent,
    ToolCall,
    _int,
    _parse_args,
    usage_from,
)


def stream_events(client, messages, tools=None, *, max_tokens=None, user=None) -> Iterator[StreamEvent]:
    t0 = time.monotonic()
    deadline = t0 + client._cap()
    resp = client._post(
        "/chat/completions",
        client._body(messages, tools, max_tokens=max_tokens, user=user, stream=True),
        stream=True, deadline=deadline,
    )
    # A small read size, so the per-line deadline below is consulted as
    # lines arrive. The default buffers 512 bytes before yielding, so a
    # stream trickling a short line every 300 ms ran 3 s past a 1 s cap
    # outside gevent (tests/chaos/test_llm_chaos.py). Not `None`: on a
    # response that is neither chunked nor sized that reads to EOF.
    try:
        lines = resp.iter_lines(chunk_size=64, decode_unicode=True)
    except TypeError:  # a response double without the parameter
        lines = resp.iter_lines(decode_unicode=True)
    _end = object()

    def _next():
        # The whole stream shares one deadline, not each read its own.
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise LlmError("LLM_TIMEOUT", "the model took too long", retryable=True)
        return _bounded(remaining, next, lines, _end)
    text: list[str] = []
    partial: dict[int, dict[str, str]] = {}
    usage_raw: dict | None = None
    finish = "stop"
    model = client.model
    try:
        while (line := _next()) is not _end:
            if not line or not line.startswith("data:"):
                continue
            payload = line[5:].strip()
            if payload == "[DONE]":
                break
            try:
                chunk = json.loads(payload)
            except ValueError:
                continue
            model = chunk.get("model") or model
            if chunk.get("usage"):
                usage_raw = chunk["usage"]
            for choice in chunk.get("choices") or []:
                delta = choice.get("delta") or {}
                if delta.get("content"):
                    text.append(delta["content"])
                    yield StreamEvent("text", delta=delta["content"])
                for tc in delta.get("tool_calls") or []:
                    slot = partial.setdefault(_int(tc.get("index")), {"id": "", "name": "", "arguments": ""})
                    fn = tc.get("function") or {}
                    slot["id"] = tc.get("id") or slot["id"]
                    slot["name"] += fn.get("name") or ""
                    slot["arguments"] += fn.get("arguments") or ""
                if choice.get("finish_reason"):
                    finish = choice["finish_reason"]
    except requests.Timeout as exc:
        raise LlmError("LLM_TIMEOUT", "the model took too long", retryable=True) from exc
    except requests.RequestException as exc:
        raise LlmError("LLM_UNAVAILABLE", "the stream broke", retryable=True) from exc
    finally:
        resp.close()
    calls = [
        ToolCall(id=s["id"] or f"call_{i}", name=s["name"], arguments=_parse_args(s["arguments"]),
                 raw_arguments=s["arguments"])
        for i, s in sorted(partial.items())
    ]
    for call in calls:
        yield StreamEvent("tool_call", call=call)
    yield StreamEvent(
        "done",
        result=ChatResult("".join(text), calls, usage_from(usage_raw, int((time.monotonic() - t0) * 1000)),
                          model, finish),
    )
