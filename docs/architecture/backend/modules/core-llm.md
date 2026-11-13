# `src/core/llm`

The one way the backend reaches a language model (§41–46).

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
