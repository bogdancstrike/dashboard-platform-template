# AI cost safety under test and load

A model call is the one request in Nucleus that costs money per call. These
are the layers that keep a test, a load run, or a thousand people from turning
into a bill.

## Server-side limits (always on)

All in `backend/src/core/llm.py`, the only path to the LiteLLM gateway, and
`backend/src/config.py`:

| setting | default | what it bounds |
|---|---|---|
| `LLM_MAX_SECONDS` | **3 s** when `ENVIRONMENT` is `test` or `load`, else 30 s | one model call, total, streaming included: socket timeouts plus a gevent timer under gunicorn, and a per-line deadline on streams. Expired → `LLM_TIMEOUT` → 503 |
| `LLM_TURN_MAX_SECONDS` | = `LLM_MAX_SECONDS` in test/load, else 45 s | a whole assistant turn: up to six calls in Data mode. A round only starts if a whole call still fits; out of time → the turn returns what it has with a note |
| `LLM_MAX_CONCURRENCY` | 4 per API worker | calls in flight; no slot within the cap → `LLM_BUSY` → 503 |
| `LLM_RATE_PER_MINUTE` | 20 per person | AI requests per person per minute (`services/ai.guard`) → 429 |
| `LLM_MODE` | `auto` (real if a key is set) | `fake` → the deterministic `FakeClient` for the whole process: no request can reach a paid model |
| `LLM_ALLOW_FAKE_HEADER` | **false** | when true, a request carrying `X-Nucleus-LLM: fake` is answered by the fake model (load tests) |

The test suite runs with `ENVIRONMENT=test` (3 s caps) and installs
`FakeClient` everywhere. The chaos tests put real sockets behind the cap
(refused, hung, slow, trickling): see [chaos.md](chaos.md).

## The load test cannot spend

* AI journeys are **off by default** (`LOADTEST_AI=off`).
* With `LOADTEST_AI=fake`, every AI request carries `X-Nucleus-LLM: fake`, and
  before sending any, the run asks `GET /api/assistant/usage` with that header
  and **disables its AI journeys unless the server answers `real: false`**. A
  server that ignores the header (the default) therefore gets no AI traffic at all.
* The recommended target is a private API in the load profile,
  `make loadtest-api` (`loadtest/private-api.sh`): `LLM_MODE=fake`, 3 s caps,
  4 workers. It never touches the shared dev API, whose default (the real
  model) stays as it is.
* To load the stack's own container instead, flip it explicitly and flip it back:

  ```sh
  docker compose -f docker-compose.yml -f loadtest/docker-compose.loadtest.yml up -d api   # flip
  LOADTEST_AI=fake make loadtest
  docker compose up -d api                                                                 # flip back
  ```

  The override sets `LLM_ALLOW_FAKE_HEADER=true` and 3 s caps. A person using
  the app meanwhile still gets the real model, under those caps.

Run D (300 users, AI journeys on, private API) made 264 AI requests at p50
10–13 ms; `ai_usage` gained no non-fake row from the run.

## Proof against the real model

`make ai-smoke` (`loadtest/ai_smoke.py`): **five** requests through
`GatewayClient` under gevent with `LLM_MAX_SECONDS=3`. The key is read from
the git-ignored `.env` and never printed. Run 2026-11-12:

```
real-model smoke: 5 requests, cap 3s, gateway http://localhost:4001/v1
  chat, short     1.32s  ok: 'OK'
  stream, short   0.95s  ok: 'OK'
  chat, long      3.00s  LLM_TIMEOUT
  stream, long    3.00s  LLM_TIMEOUT
  embed           0.37s  ok: '3072 dims'
longest call 3.00s against a cap of 3s
PASS: no call outlived the cap
```

The two long generations (a 3000-word essay, `max_tokens=4000`) were abandoned
at exactly 3.00 s.

## Left to consider

* `knowledge_ingest.embed` embeds a document in batches, each call capped, but
  with no per-document total. It runs as a background job and spends embedding
  tokens in proportion to the document, by design.
* The concurrency ceiling is per worker process; the cluster-wide ceiling is
  `LLM_MAX_CONCURRENCY × WEB_CONCURRENCY`.
