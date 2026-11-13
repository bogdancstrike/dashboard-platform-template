"""The one way the backend reaches a language model (§41–46).
See docs/architecture/backend/llm.md."""

from __future__ import annotations

from src.core.facade import lazy

__getattr__, __dir__, __all__ = lazy(__name__, {
    "results": (
        "Usage", "ToolCall", "ChatResult", "StreamEvent", "LlmError", "parse_json", "_int",
        "usage_from", "_parse_args",
    ),
    "limits": (
        "FAKE_HEADER", "_Expired", "max_seconds", "_slots", "_slots_size", "_slots_lock",
        "_semaphore", "slot", "_bounded",
    ),
    "client": ("LlmClient",),
    "gateway": ("GatewayClient",),
    "fake": (
        "_classify", "Scripted", "_last_user", "_tool_results_since_user", "FakeClient",
        "hash_embedding",
    ),
    "selection": (
        "_client", "_client_lock", "mode", "_header_fake", "_fake_requested", "get_client",
        "set_client", "is_real",
    ),
})
