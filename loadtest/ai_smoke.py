"""Prove the 3-second cap against the REAL model — five requests, no more.

    loadtest/.venv/bin/python loadtest/ai_smoke.py      # or: make ai-smoke

Costs real tokens, so it is deliberately tiny: two short calls that should
answer, two long ones that must be cut off at the cap, one embedding. Every
call goes through `src.core.llm.GatewayClient` (the only path to a paid model)
with `LLM_MAX_SECONDS=3`, under gevent like the API's workers, and the script
fails if any call outlives the cap by more than half a second.

The gateway key is read from the git-ignored repo-root `.env`
(`LITELLM_MASTER_KEY`) and never printed.
"""

from __future__ import annotations

from gevent import monkey

monkey.patch_all()

import os  # noqa: E402
import sys  # noqa: E402
import time  # noqa: E402
from pathlib import Path  # noqa: E402

REPO = Path(__file__).resolve().parents[1]
CAP = float(os.getenv("LLM_MAX_SECONDS", "3"))
MAX_REQUESTS = 5


def _key() -> str:
    if os.getenv("LLM_API_KEY"):
        return os.environ["LLM_API_KEY"]
    for line in (REPO / ".env").read_text().splitlines():
        if line.startswith("LITELLM_MASTER_KEY="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise SystemExit("no LITELLM_MASTER_KEY in .env and no LLM_API_KEY set")


def main() -> int:
    os.environ.update(ENVIRONMENT="load", LLM_MAX_SECONDS=str(CAP), LLM_MODE="real",
                      LLM_BASE_URL=os.getenv("LLM_BASE_URL", "http://localhost:4001/v1"), LLM_API_KEY=_key())
    sys.path.insert(0, str(REPO / "backend"))
    from src.core import llm

    client = llm.GatewayClient()
    assert client.timeout >= CAP and llm.max_seconds() == CAP, "the cap is not in force"
    short = [{"role": "user", "content": "Reply with exactly the word OK."}]
    long = [{"role": "user", "content": "Write a detailed 3000-word essay on the history of databases."}]

    def chat_short():
        return client.chat(short, max_tokens=16).text.strip()[:20]

    def stream_short():
        return "".join(e.delta for e in client.stream(short, max_tokens=16) if e.kind == "text")[:20]

    def chat_long():
        return client.chat(long, max_tokens=4000).text[:20]

    def stream_long():
        return f"{sum(len(e.delta) for e in client.stream(long, max_tokens=4000) if e.kind == 'text')} chars"

    def embed():
        return f"{len(client.embed(['load test smoke'])[0])} dims"

    calls = [("chat, short", chat_short), ("stream, short", stream_short), ("chat, long", chat_long),
             ("stream, long", stream_long), ("embed", embed)][:MAX_REQUESTS]
    worst = 0.0
    print(f"real-model smoke: {len(calls)} requests, cap {CAP:g}s, gateway {os.environ['LLM_BASE_URL']}")
    for label, call in calls:
        started = time.perf_counter()
        try:
            outcome = f"ok: {call()!r}"
        except llm.LlmError as exc:
            outcome = f"{exc.code}"
        took = time.perf_counter() - started
        worst = max(worst, took)
        print(f"  {label:14s} {took:5.2f}s  {outcome}")
    print(f"longest call {worst:.2f}s against a cap of {CAP:g}s")
    if worst > CAP + 0.5:
        print("FAIL: a call outlived the cap")
        return 1
    print("PASS: no call outlived the cap")
    return 0


if __name__ == "__main__":
    sys.exit(main())
