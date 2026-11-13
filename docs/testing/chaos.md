# Chaos: what happens when a dependency fails

`make test-chaos` (`backend/tests/chaos/`). Faults are injected **in the test
process**: a closed port (*refused*), a socket that accepts and never answers
(*hung*, `BlackHole`), an HTTP server that answers late or trickles (*slow*,
`SlowHttp`), or a patched client. No shared container is stopped. The tests
without the `database` marker run anywhere; the rest need the stack's
PostgreSQL (`make test-chaos` sets it up).

The contract for every dependency: **degrade, don't fail; fail fast, not slow;
fail as a 503 with the normal envelope, never a 500.**

| dependency | failure | what the API does | test | fixed here |
|---|---|---|---|---|
| **PostgreSQL** | refused / hung (connect timeout) | 503 `service_unavailable`, `details.dependency = "database"`, `Retry-After: 5`, within seconds; `/health/live` 200, `/health/ready` 503; no token is still 401 | `test_database_chaos.py` | **yes**: was a 500 "internal server error" (`core/errors.database_unavailable`) |
| | pool exhausted | waits `pool_timeout`, then the same 503 | `test_an_exhausted_pool_is_a_503_after_the_pool_timeout` | yes (same) |
| | slow (+30 ms per statement) | correct answers, later | `test_a_slow_database_is_slower_not_broken` | n/a |
| **Redis** (cache) | refused | every cache read is a miss, writes are dropped; dashboards, counts and auth all answer | `test_redis_chaos.py` | n/a |
| | hung | **one** 2 s timeout, then the cache steps aside for 30 s | `test_a_hung_redis_costs_one_timeout_then_the_cache_steps_aside` | **yes**: every cache call paid the 2 s timeout (several per request) |
| | back after an outage | the cache is used again within 30 s, without an API restart | `test_the_cache_comes_back_after_redis_does` | **yes**: one failure disabled caching for the life of the process |
| | writes during the outage | their generation bumps are replayed on reconnect, so no pre-outage aggregate looks fresh | `test_recovery_retires_aggregates_cached_before_the_outage` | yes (new with recovery) |
| **MinIO** (files) | refused / hung | file list and folder tree answer (they are database rows); a download, stat, put or delete is a 503 `dependency: "storage"` within seconds; presigned upload/download URLs still work (signed locally) | `test_storage_chaos.py` | **yes**: botocore's 60 s connect timeout plus retries held a download for minutes, then a 500; `ensure_bucket` raising at first use broke even the tree |
| **Keycloak** JWKS | refused / hung | the last fetched keys keep verifying tokens; one refresh attempt, then 15 s back-off; an unknown `kid` while down is a 401 | `test_keycloak_chaos.py` | **yes**: with a stale cache every request re-fetched, each a 5 s wait behind a lock when Keycloak hangs |
| **LiteLLM** (AI) | refused | `LLM_UNAVAILABLE` at once → 503 "The AI service could not answer just now" | `test_llm_chaos.py` | n/a |
| | hung / slow answer | `LLM_TIMEOUT` at `LLM_MAX_SECONDS` (3 s in test/load) → 503 | `test_hung_gateway_times_out_at_the_cap`, `test_slow_answer_is_abandoned_at_the_cap` | n/a (the AI agent's cap) |
| | stream that trickles forever | cut at the cap | `test_a_trickling_stream_stops_at_the_cap` | **yes**: the stream read 512-byte chunks, so outside gevent it ran 3 s past a 1 s cap |
| | AI endpoints end to end | page help / filters answer 200 (their non-AI fallback) or 503, within 2 × cap | `test_ai_endpoints_answer_503_within_the_cap` | n/a |
| | a Data-mode turn with many tool rounds | the whole turn stops at `LLM_TURN_MAX_SECONDS`, returning what it has with a note | `test_llm_turn_budget.py` | **yes**: new budget |
| **Live channel** | worker retiring (deploy, `max_requests`) | its sockets are closed with 1012 at once; the browser reconnects with back-off and polls meanwhile | `test_websocket_chaos.py`; browser side `frontend/src/live/LiveProvider.test.tsx` ("reconnects with backoff after the socket drops", "treats a silent socket as dead", "polls until the socket opens") | **yes**: a retiring worker waited 30 s on sockets that never end, refusing all traffic |

## Verifying against the real stack

All of the above is in-process. The live checks done during this pass,
announced here as the brief asks:

* **No container was stopped.** Redis, LiteLLM, MinIO, Keycloak and PostgreSQL
  stayed up throughout. The load test's websocket users exercise live-channel
  drops against the real server (C: 0 % connect failures).
* The AI cap was proven against the **real model**: `make ai-smoke`, five
  requests, see [ai-cost-safety.md](ai-cost-safety.md).

## Fix locations

| fix | file |
|---|---|
| DB outage → 503 + Retry-After; NUL / out-of-range input → 400 | `backend/src/core/errors.py` |
| cache breaker, recovery, lost-bump replay | `backend/src/core/cache.py` |
| JWKS stale keys + back-off | `backend/src/core/auth.py` (`_JwksCache`) |
| storage timeouts, outage → 503, tolerant `ensure_bucket` | `backend/src/core/storage.py` |
| stream read size | `backend/src/core/llm.py` (`GatewayClient._stream`) |
| turn budget | `backend/src/services/assistant.py`, `backend/src/config.py` (`LLM_TURN_MAX_SECONDS`) |
| socket drain on retire, recycling spread | `backend/gunicorn.conf.py` |
