# Load test

Locust, 1000 concurrent users, realistic journeys, against the running stack.
Results and the bottlenecks found: [docs/testing/performance.md](../docs/testing/performance.md).

```sh
make loadtest                                   # 1000 users, 10/s ramp, 5 min, against :5101
make loadtest USERS=300 RATE=20 DURATION=2m     # smaller
make loadtest-api                               # (another terminal) a private API on :5197, load profile
LOADTEST_HOST=http://localhost:5197 make loadtest
make loadtest-ui                                # Locust's web UI on :8089
```

`run.sh` does, in order:
1. refuses to start unless the target answers `/platform/meta/app` like
   Nucleus (a port taken by another dev server answers 200 to everything);
2. `tokens.py`: **one** Keycloak direct grant per seeded persona (admin,
   manager, operator, analyst, user), cached in `.tokens.json` and renewed with
   the refresh grant. Brute-force protection is on in the realm, so the run
   never signs in more than five times, and usually zero (the cache is reused);
3. `cleanup.py snapshot`: the row count of every table;
4. Locust headless → `reports/<run>.html`, `<run>_stats*.csv`, `<run>_failures.csv`;
   server CPU/memory and Postgres connections sampled every 5 s → `<run>-docker.txt`;
5. `cleanup.py clean <run>`: hard-deletes the throwaway kanban boards, lanes,
   cards and their activity rows, and the run's audit and request-log rows
   (every request carries `X-Correlation-ID: lt-<run>-…`);
6. `cleanup.py diff`: any table the load test writes that still differs is a
   **LEAK** and fails; other tables are listed as other people's traffic;
7. `summarize.py` → `reports/<run>_SUMMARY.md` (committed; everything else in
   `reports/` is git-ignored).

## Safety

* **No real AI spend.** AI journeys run only with `LOADTEST_AI=fake`, carry
  `X-Nucleus-LLM: fake`, and switch themselves off unless the server confirms
  `real: false`. `private-api.sh` runs with `LLM_MODE=fake`. Details:
  [docs/testing/ai-cost-safety.md](../docs/testing/ai-cost-safety.md).
* **Circuit breaker.** If more than 25 % of requests fail, or the median passes
  15 s, for 30 s, the run stops itself (`LOADTEST_ABORT_FAIL_RATIO`,
  `LOADTEST_ABORT_MEDIAN_MS`).
* **Writes only on throwaway data** it creates and removes. The reads write
  only the request log (cleaned) and the five persona sessions (reused).

## Knobs

| variable | default | |
|---|---|---|
| `LOADTEST_HOST` | `http://localhost:5101` | API origin (path prefix `/platform`) |
| `LOADTEST_AI` | `off` | `fake` to include AI journeys (fake model only) |
| `LOADTEST_WRITES` | `on` | `off` for a read-only run |
| `LOADTEST_WS` / `LOADTEST_WS_WEIGHT` | `on` / `1` | live-channel users (weight 1 vs 20 for browsing users) |
| `LOADTEST_WAIT_MIN/MAX` | 2 / 8 s | think time |
| `LOADTEST_PROCESSES` | 1 | Locust worker processes (one handles 1000 users) |
| `LOADTEST_RUN_ID` | UTC timestamp | names the reports and scopes the cleanup |

Other tools here: `ai_smoke.py` (five real-model calls proving the 3 s cap,
`make ai-smoke`), `frontend/bundle-budget.mjs` (`make bundle-budget`),
`frontend/web-vitals.mjs` (`make web-vitals`),
`docker-compose.loadtest.yml` (opt-in load profile for the stack's container).
