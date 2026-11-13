"""What a model call returns: usage, tool calls, results, stream events, errors."""

from __future__ import annotations

import json
import re
from dataclasses import asdict, dataclass, field
from typing import Any


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
