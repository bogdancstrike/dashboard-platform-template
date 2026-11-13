"""The interface every model client implements."""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any, Protocol

from src.core.llm.results import ChatResult, StreamEvent


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
