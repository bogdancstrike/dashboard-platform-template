"""The one way the backend reaches a language model (§41–46).

Every AI feature talks to the LiteLLM gateway through this module and nothing
else: the gateway is OpenAI-compatible, holds the provider key, and names the
model by alias (``LLM_MODEL`` = ``nucleus-chat``). The client is synchronous —
the API serves on gevent workers, so a blocking ``requests`` call yields to the
other greenlets while it waits on the socket.

Two implementations share one shape:

* :class:`GatewayClient` — Chat Completions over HTTP, with tool calls,
  server-sent-event streaming, timeouts and error classification.
* :class:`FakeClient` — scripted and deterministic. Used when
  ``LLM_MODE=fake``, and in ``auto`` mode when no key is configured, so tests
  and key-less laptops never spend a token. Tests can queue exact replies
  (``FakeClient(script=[...])``) and install it with :func:`set_client`.

Usage::

    from src.core import llm

    result = llm.get_client().chat([{"role": "user", "content": "Hi"}])
    for event in llm.get_client().stream(messages, tools=tools):
        if event.kind == "text": ...
        elif event.kind == "done": usage = event.result.usage

Messages and tools are the plain OpenAI Chat Completions dictionaries, so a
feature can build them without importing anything from here.

Limits (real money — every feature inherits them by calling through here):

* ``LLM_MAX_SECONDS`` — hard cap on a call's *total* duration, streaming
  included (3 s when ``ENVIRONMENT`` is ``test`` or ``load``, else 30 s).
  Exceeded → ``LlmError("LLM_TIMEOUT")``.
* ``LLM_MAX_CONCURRENCY`` — model calls in flight per worker; no slot within
  the time cap → ``LlmError("LLM_BUSY")``.
* Per-user rate limit — ``LLM_RATE_PER_MINUTE``, enforced by
  ``src.services.ai.usage.guard`` (counts the ``ai_usage`` ledger).
* ``LLM_MODE=fake`` forces the fake for the whole process; with
  ``LLM_ALLOW_FAKE_HEADER=true`` a request carrying ``X-Nucleus-LLM: fake``
  gets the fake for that request only (load tests).

Callers turn an ``LlmError`` into a clean 503 envelope with
``src.services.ai.usage.unavailable`` — never a 500, never a hang.
"""

from __future__ import annotations

import hashlib
import json
import math
import re
import threading
import time
from contextlib import contextmanager
from collections.abc import Callable, Iterable, Iterator
from dataclasses import asdict, dataclass, field
from typing import Any, Protocol

import requests

from src.config import Config


# ── Types ─────────────────────────────────────────────────────────────────


@dataclass
class Usage:
    """Token counts as the gateway reports them (completion includes reasoning)."""

    prompt_tokens: int = 0
    completion_tokens: int = 0
    reasoning_tokens: int = 0
    cached_tokens: int = 0
    latency_ms: int = 0

    @property
    def total_tokens(self) -> int:
        return self.prompt_tokens + self.completion_tokens

    def add(self, other: Usage) -> Usage:
        return Usage(
            self.prompt_tokens + other.prompt_tokens,
            self.completion_tokens + other.completion_tokens,
            self.reasoning_tokens + other.reasoning_tokens,
            self.cached_tokens + other.cached_tokens,
            self.latency_ms + other.latency_ms,
        )

    def to_dict(self) -> dict[str, int]:
        return {**asdict(self), "total_tokens": self.total_tokens}


@dataclass
class ToolCall:
    id: str
    name: str
    arguments: dict[str, Any]
    raw_arguments: str = ""

    def to_message(self) -> dict[str, Any]:
        """The ``tool_calls`` entry of the assistant message that made this call."""
        return {
            "id": self.id,
            "type": "function",
            "function": {"name": self.name, "arguments": self.raw_arguments or json.dumps(self.arguments)},
        }


@dataclass
class ChatResult:
    text: str
    tool_calls: list[ToolCall] = field(default_factory=list)
    usage: Usage = field(default_factory=Usage)
    model: str = ""
    finish_reason: str = "stop"

    def assistant_message(self) -> dict[str, Any]:
        """This reply as the assistant message to append before the tool results."""
        msg: dict[str, Any] = {"role": "assistant", "content": self.text or None}
        if self.tool_calls:
            msg["tool_calls"] = [c.to_message() for c in self.tool_calls]
        return msg

    def json(self) -> Any:
        """The reply parsed as JSON (tolerating a fenced code block); raises LlmError."""
        return parse_json(self.text)


@dataclass
class StreamEvent:
    """``text`` (``delta``), ``tool_call`` (``call``) or ``done`` (``result``)."""

    kind: str
    delta: str = ""
    call: ToolCall | None = None
    result: ChatResult | None = None


class LlmError(Exception):
    """A failed model call. ``code`` is one of LLM_RATE_LIMITED, LLM_UNAVAILABLE,
    LLM_TIMEOUT (retryable), LLM_AUTH, LLM_INVALID_REQUEST, LLM_BAD_OUTPUT."""

    def __init__(self, code: str, message: str, *, retryable: bool = False, status: int | None = None):
        super().__init__(f"{code}: {message}")
        self.code = code
        self.message = message
        self.retryable = retryable
        self.status = status


def parse_json(text: str) -> Any:
    raw = (text or "").strip()
    fenced = re.search(r"```(?:json)?\s*(.*?)```", raw, re.S)
    if fenced:
        raw = fenced.group(1).strip()
    if not raw.startswith(("{", "[")):
        start = min((i for i in (raw.find("{"), raw.find("[")) if i >= 0), default=-1)
        if start >= 0:
            raw = raw[start:]
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, ValueError) as exc:
        raise LlmError("LLM_BAD_OUTPUT", "the model did not answer with JSON") from exc


def _int(v: Any) -> int:
    try:
        return max(int(v or 0), 0)
    except (TypeError, ValueError):
        return 0


def usage_from(raw: dict[str, Any] | None, latency_ms: int = 0) -> Usage:
    raw = raw or {}
    details = raw.get("completion_tokens_details") or {}
    prompt_details = raw.get("prompt_tokens_details") or {}
    return Usage(
        prompt_tokens=_int(raw.get("prompt_tokens")),
        completion_tokens=_int(raw.get("completion_tokens")),
        reasoning_tokens=_int(details.get("reasoning_tokens")),
        cached_tokens=_int(prompt_details.get("cached_tokens")),
        latency_ms=latency_ms,
    )


def _parse_args(raw: str) -> dict[str, Any]:
    try:
        value = json.loads(raw or "{}")
    except (json.JSONDecodeError, ValueError):
        return {"__invalid_json__": raw}
    return value if isinstance(value, dict) else {"value": value}


# ── Limits ────────────────────────────────────────────────────────────────

FAKE_HEADER = "X-Nucleus-LLM"


class _Expired(Exception):
    """Raised inside a call by the gevent timer when the time cap passes."""


def max_seconds() -> float:
    return max(0.05, float(Config.LLM_MAX_SECONDS or 30))


_slots: threading.BoundedSemaphore | None = None
_slots_size = 0
_slots_lock = threading.Lock()


def _semaphore() -> threading.BoundedSemaphore:
    global _slots, _slots_size
    size = max(1, int(Config.LLM_MAX_CONCURRENCY or 1))
    with _slots_lock:
        if _slots is None or _slots_size != size:
            _slots, _slots_size = threading.BoundedSemaphore(size), size
        return _slots


@contextmanager
def slot(timeout: float | None = None):
    """One of the LLM_MAX_CONCURRENCY slots, or LLM_BUSY within the time cap."""
    sem = _semaphore()
    if not sem.acquire(timeout=max_seconds() if timeout is None else timeout):
        raise LlmError("LLM_BUSY", "too many model calls in flight", retryable=True)
    try:
        yield
    finally:
        sem.release()


def _bounded(seconds: float, fn, *args, **kwargs):
    """Run fn with a hard wall-clock cap when the process is gevent-patched
    (gunicorn's workers are); otherwise the socket timeouts are the cap."""
    if seconds <= 0:
        raise LlmError("LLM_TIMEOUT", "the model took too long", retryable=True)
    try:
        from gevent import Timeout, monkey

        patched = monkey.is_module_patched("socket")
    except ImportError:  # pragma: no cover - gevent is a requirement
        patched = False
    if not patched:
        return fn(*args, **kwargs)
    try:  # pragma: no cover - exercised under gunicorn/gevent only
        with Timeout(seconds, _Expired):
            return fn(*args, **kwargs)
    except _Expired as exc:  # pragma: no cover
        raise LlmError("LLM_TIMEOUT", "the model took too long", retryable=True) from exc


# ── Interface ─────────────────────────────────────────────────────────────


class LlmClient(Protocol):
    model: str
    is_fake: bool

    def chat(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
        *,
        json_mode: bool = False,
        max_tokens: int | None = None,
        user: str | None = None,
    ) -> ChatResult: ...

    def stream(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
        *,
        max_tokens: int | None = None,
        user: str | None = None,
    ) -> Iterator[StreamEvent]: ...

    def embed(self, texts: list[str]) -> list[list[float]]: ...


# ── The gateway ───────────────────────────────────────────────────────────


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
        t0 = time.monotonic()
        deadline = t0 + self._cap()
        resp = self._post(
            "/chat/completions",
            self._body(messages, tools, max_tokens=max_tokens, user=user, stream=True),
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
        model = self.model
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


# ── The fake ──────────────────────────────────────────────────────────────

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


# ── Selection ─────────────────────────────────────────────────────────────

_client: LlmClient | None = None
_client_lock = threading.Lock()


def mode() -> str:
    """``real`` or ``fake`` — what :func:`get_client` hands out."""
    m = (Config.LLM_MODE or "auto").strip().lower()
    if m in ("fake", "real"):
        return m
    return "real" if Config.LLM_API_KEY else "fake"


_header_fake: FakeClient | None = None


def _fake_requested() -> bool:
    """`X-Nucleus-LLM: fake` on this request, when LLM_ALLOW_FAKE_HEADER allows it."""
    if not Config.LLM_ALLOW_FAKE_HEADER:
        return False
    try:
        from flask import has_request_context, request
    except ImportError:  # pragma: no cover
        return False
    return has_request_context() and request.headers.get(FAKE_HEADER, "").strip().lower() == "fake"


def get_client() -> LlmClient:
    global _client, _header_fake
    if _fake_requested():
        if _header_fake is None:
            _header_fake = FakeClient()
        return _header_fake
    if _client is None:
        with _client_lock:
            if _client is None:
                _client = FakeClient() if mode() == "fake" else GatewayClient()
    return _client


def set_client(client: LlmClient | None) -> None:
    """Install a client (tests); ``None`` goes back to the configured one."""
    global _client
    _client = client


def is_real() -> bool:
    return not getattr(get_client(), "is_fake", False)
