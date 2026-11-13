"""The LiteLLM gateway client (OpenAI-compatible)."""

from __future__ import annotations

import time
from collections.abc import Iterator
from typing import Any

import requests

from src.config import Config
from src.core.llm.fake import _classify
from src.core.llm.gateway_stream import stream_events
from src.core.llm.limits import _bounded, max_seconds, slot
from src.core.llm.results import (
    ChatResult,
    LlmError,
    StreamEvent,
    ToolCall,
    _parse_args,
    usage_from,
)


class GatewayClient:
    """OpenAI-compatible Chat Completions against the LiteLLM gateway."""

    is_fake = False

    def __init__(
        self,
        base_url: str | None = None,
        api_key: str | None = None,
        model: str | None = None,
        *,
        embedding_model: str | None = None,
        reasoning_effort: str | None = None,
        timeout: float | None = None,
        session: requests.Session | None = None,
    ):
        self.base_url = (base_url or Config.LLM_BASE_URL).rstrip("/")
        self._key = api_key if api_key is not None else Config.LLM_API_KEY
        self.model = model or Config.LLM_MODEL
        self.embedding_model = embedding_model or Config.LLM_EMBEDDING_MODEL
        self.reasoning_effort = reasoning_effort if reasoning_effort is not None else Config.LLM_REASONING_EFFORT
        self.timeout = timeout or Config.LLM_TIMEOUT_SECONDS
        self.session = session or requests.Session()

    def __repr__(self) -> str:  # never the key
        return f"GatewayClient(base_url={self.base_url!r}, model={self.model!r})"

    # -- plumbing
    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self._key}", "Content-Type": "application/json"}

    def _body(self, messages, tools, *, json_mode=False, max_tokens=None, user=None, stream=False) -> dict:
        body: dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "max_completion_tokens": max_tokens or Config.LLM_MAX_OUTPUT_TOKENS,
        }
        if self.reasoning_effort:
            body["reasoning_effort"] = self.reasoning_effort
        if tools:
            body["tools"] = tools
        if json_mode:
            body["response_format"] = {"type": "json_object"}
        if user:
            body["user"] = str(user)
        if stream:
            body["stream"] = True
            body["stream_options"] = {"include_usage": True}
        return body

    def _cap(self) -> float:
        return min(float(self.timeout), max_seconds())

    def _post(self, path: str, body: dict, *, stream: bool = False, deadline: float | None = None) -> requests.Response:
        cap = self._cap() if deadline is None else deadline - time.monotonic()
        try:
            resp = _bounded(
                cap, self.session.post,
                f"{self.base_url}{path}", headers=self._headers(), json=body,
                timeout=(min(5.0, max(cap, 0.05)), max(cap, 0.05)), stream=stream,
            )
        except requests.Timeout as exc:
            raise LlmError("LLM_TIMEOUT", "the model took too long", retryable=True) from exc
        except requests.RequestException as exc:
            raise LlmError("LLM_UNAVAILABLE", type(exc).__name__, retryable=True) from exc
        if resp.status_code >= 400:
            raise _classify(resp)
        return resp

    # -- API
    def chat(self, messages, tools=None, *, json_mode=False, max_tokens=None, user=None) -> ChatResult:
        t0 = time.monotonic()
        with slot():
            resp = self._post(
                "/chat/completions",
                self._body(messages, tools, json_mode=json_mode, max_tokens=max_tokens, user=user),
                deadline=t0 + self._cap(),
            )
            try:
                data = _bounded(t0 + self._cap() - time.monotonic(), resp.json)
            except ValueError:
                data = None
        try:
            choice = data["choices"][0]
        except (TypeError, KeyError, IndexError) as exc:
            raise LlmError("LLM_BAD_OUTPUT", "unreadable gateway response") from exc
        msg = choice.get("message") or {}
        calls = [
            ToolCall(
                id=c.get("id") or f"call_{i}",
                name=(c.get("function") or {}).get("name", ""),
                arguments=_parse_args((c.get("function") or {}).get("arguments", "")),
                raw_arguments=(c.get("function") or {}).get("arguments", ""),
            )
            for i, c in enumerate(msg.get("tool_calls") or [])
        ]
        return ChatResult(
            text=msg.get("content") or "",
            tool_calls=calls,
            usage=usage_from(data.get("usage"), int((time.monotonic() - t0) * 1000)),
            model=data.get("model") or self.model,
            finish_reason=choice.get("finish_reason") or "stop",
        )

    def stream(self, messages, tools=None, *, max_tokens=None, user=None) -> Iterator[StreamEvent]:
        with slot():
            yield from self._stream(messages, tools, max_tokens=max_tokens, user=user)

    def _stream(self, messages, tools=None, *, max_tokens=None, user=None) -> Iterator[StreamEvent]:
        return stream_events(self, messages, tools, max_tokens=max_tokens, user=user)

    def embed(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        with slot():
            resp = self._post("/embeddings", {"model": self.embedding_model, "input": texts})
        try:
            rows = sorted(resp.json()["data"], key=lambda d: d.get("index", 0))
            return [r["embedding"] for r in rows]
        except (ValueError, KeyError, TypeError) as exc:
            raise LlmError("LLM_BAD_OUTPUT", "unreadable embeddings response") from exc
