"""Choosing the client: mode, the fake header, overrides."""

from __future__ import annotations

import threading

from src.config import Config
from src.core.llm.client import LlmClient
from src.core.llm.fake import FakeClient
from src.core.llm.gateway import GatewayClient
from src.core.llm.limits import FAKE_HEADER

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
