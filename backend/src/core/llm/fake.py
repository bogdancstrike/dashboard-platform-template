"""Deterministic fake clients, for tests and LLM_MODE=fake."""

from __future__ import annotations

import hashlib
import json
import math
import re
import threading
from collections.abc import Callable, Iterable, Iterator
from typing import Any

import requests

from src.core.llm.results import ChatResult, LlmError, StreamEvent, ToolCall, Usage


def _classify(resp: requests.Response) -> LlmError:
    status = resp.status_code
    try:
        detail = str((resp.json().get("error") or {}).get("message", ""))[:300]
    except (ValueError, AttributeError):
        detail = ""
    if status == 429:
        return LlmError("LLM_RATE_LIMITED", detail or "rate limited", retryable=True, status=status)
    if status in (401, 403):
        return LlmError("LLM_AUTH", "the gateway rejected the key", status=status)
    if status >= 500:
        return LlmError("LLM_UNAVAILABLE", detail or f"HTTP {status}", retryable=True, status=status)
    return LlmError("LLM_INVALID_REQUEST", detail or f"HTTP {status}", status=status)


#: A scripted reply: a ChatResult, a plain string (the text), or a callable
#: ``(messages, tools) -> ChatResult | str``.
Scripted = ChatResult | str | Callable[[list[dict], list[dict] | None], "ChatResult | str"]


def _last_user(messages: list[dict]) -> str:
    for m in reversed(messages):
        if m.get("role") == "user":
            c = m.get("content")
            if isinstance(c, list):
                return " ".join(p.get("text", "") for p in c if isinstance(p, dict))
            return str(c or "")
    return ""


def _tool_results_since_user(messages: list[dict]) -> list[dict]:
    out: list[dict] = []
    for m in reversed(messages):
        if m.get("role") == "user":
            break
        if m.get("role") == "tool":
            out.append(m)
    return list(reversed(out))


class FakeClient:
    """Deterministic stand-in. With a script it replays it in order; without
    one it answers by rule: call the first tool once (arguments derived from
    the question), then summarise what the tool returned; in JSON mode, an
    empty object — the caller's fallback decides what that means."""

    is_fake = True

    def __init__(self, script: Iterable[Scripted] | None = None, *, model: str = "fake-model"):
        self.model = model
        self.script: list[Scripted] = list(script or [])
        self.calls: list[dict[str, Any]] = []
        self._lock = threading.Lock()

    def _next(self, messages, tools, json_mode) -> ChatResult:
        self.calls.append({"messages": messages, "tools": tools, "json_mode": json_mode})
        with self._lock:
            item = self.script.pop(0) if self.script else None
        if callable(item) and not isinstance(item, ChatResult):
            item = item(messages, tools)
        if isinstance(item, str):
            item = ChatResult(text=item)
        if item is None:
            item = self._rule(messages, tools, json_mode)
        size = sum(len(json.dumps(m, default=str)) for m in messages)
        item.usage = Usage(max(1, size // 4), max(1, len(item.text) // 4 + 8 * len(item.tool_calls)), 0, 0, 1)
        item.model = item.model or self.model
        if item.tool_calls:
            item.finish_reason = "tool_calls"
        return item

    def _rule(self, messages, tools, json_mode) -> ChatResult:
        question = _last_user(messages)
        if json_mode:
            return ChatResult(text="{}")
        results = _tool_results_since_user(messages)
        if tools and not results:
            tool = tools[0].get("function", tools[0])
            props = (tool.get("parameters") or {}).get("properties") or {}
            args: dict[str, Any] = {}
            for name, spec in props.items():
                if name in ("query", "q", "question", "text", "search"):
                    args[name] = " ".join(re.findall(r"[A-Za-z]{4,}", question)[:3]) or question[:40]
                elif name == "limit":
                    args[name] = 5
                elif "enum" in spec and name in (tool.get("parameters") or {}).get("required", []):
                    args[name] = spec["enum"][0]
            raw = json.dumps(args)
            digest = hashlib.sha1(f"{question}|{tool.get('name')}".encode()).hexdigest()[:12]
            return ChatResult(text="", tool_calls=[ToolCall(f"call_{digest}", tool.get("name", ""), args, raw)])
        if results:
            excerpt = str(results[-1].get("content", ""))[:240]
            return ChatResult(text=f"**(fake model)** From the records I looked up: `{excerpt}`")
        return ChatResult(text=f"**(fake model)** You asked: _{question[:200]}_. Set `LLM_MODE` to use the real model.")

    def chat(self, messages, tools=None, *, json_mode=False, max_tokens=None, user=None) -> ChatResult:
        return self._next(messages, tools, json_mode)

    def stream(self, messages, tools=None, *, max_tokens=None, user=None) -> Iterator[StreamEvent]:
        result = self._next(messages, tools, False)
        for i in range(0, len(result.text), 16):
            yield StreamEvent("text", delta=result.text[i:i + 16])
        for call in result.tool_calls:
            yield StreamEvent("tool_call", call=call)
        yield StreamEvent("done", result=result)

    def embed(self, texts: list[str]) -> list[list[float]]:
        return [hash_embedding(t) for t in texts]


def hash_embedding(text: str, dims: int = 256) -> list[float]:
    """Deterministic bag-of-words embedding: similar wording, similar vectors."""
    v = [0.0] * dims
    for tok in re.findall(r"[a-z0-9]+", (text or "").lower()):
        for t in (tok, tok[:5]):
            h = int(hashlib.blake2b(t.encode(), digest_size=8).hexdigest(), 16)
            v[h % dims] += 1.0 if (h >> 63) & 1 else -1.0
    n = math.sqrt(sum(x * x for x in v)) or 1.0
    return [x / n for x in v]
