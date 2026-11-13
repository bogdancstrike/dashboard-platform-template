# Performance and load

How Nucleus behaves under 1000 concurrent users, what was in the way, what was
fixed, and the budgets that keep it fixed. Measured 2026-11-12 on the dev box
(32 cores, 60 GB, shared with other stacks), against the seeded demo data.

| | command |
|---|---|
| 1000-user load test (headless, reports + cleanup) | `make loadtest` (`USERS=… RATE=… DURATION=…`, `LOADTEST_HOST=…`) |
| a private API in the load profile to aim at | `make loadtest-api` → `LOADTEST_HOST=http://localhost:5197 make loadtest` |
| statement-count / N+1 budgets | `make test-perf` |
| bundle-size budget | `make bundle-budget` |
| page metrics (FCP, LCP, TBT, CLS) | `make web-vitals` (`THROTTLE=4` for a slow CPU) |

The load test itself is described in [loadtest/README.md](../../loadtest/README.md);
chaos and edge cases in [chaos.md](chaos.md) and [security-edge-cases.md](security-edge-cases.md).

## The workload

`loadtest/locustfile.py` — one Locust user is one person with the app open,
2–8 s of think time between actions, personas weighted like real use (user 40 %,
operator 20 %, manager 15 %, analyst 15 %, admin 10 %), every request on the
path and in the shape the frontend sends:

| journey (weight) | requests |
|---|---|
| bell polling (14) | `GET /notifications/counts` |
| browse a list (16) | `POST /api/explorer/query` with facets, filters, sort, sometimes a search term, then page 2–10 |
| record detail (10) | record, audit timeline, comments, tags, sometimes relationships |
| home (8), dashboard (6) | me, announcements, activity, favourites, recents; summary + alerts |
| global search (8) | the palette's prefix-then-word sequence |
| advanced query (4) | nested AND/OR rule tree |
| insights (4), kanban read (4), files (3), calendar (3), mail (3), notifications (3) | |
| kanban move (3) — **writes** | moves cards on throwaway boards the run creates and deletes |
| exports (2) — estimate, list, rarely a real export (deleted at the end) | |
| admin pages (3, admins only), profiles (1), reports + dashboards (2) | |
| live channel | ~5 % of users hold `/platform/live` open 20–60 s, answer pings, reconnect |
| AI (2) | only with `LOADTEST_AI=fake`, and only if the server confirms the fake model |

## Results: 1000 users, before and after

All runs ramp 1000 users at 10/s, then hold. Runs **A**, **B** and **C** aim at a
private API process (`loadtest/private-api.sh`) with the same database, Redis,
Keycloak and MinIO as the stack. That keeps the shared API usable for everyone
else, and keeps the auto-deployer from restarting the target mid-run (the first,
"baseline" run against the shared container was cut by exactly that, so it is
kept as a record only).

| run | code | workers × DB pool | peak / mean req/s | p50 | p95 | p99 | failures |
|---|---|---|---|---|---|---|---|
| baseline (shared container) | before | 2 × (10+20) | 209 / 93 | 1.5 s | 31 s | 38 s | 9.68 % (incl. a redeploy) |
| **A** | before | 2 × (10+20) | 178 / 90 | 2.3 s | 25 s | 35 s | 1.22 % |
| **B** | after | 2 × (10+20) | 196 / 145 | 1.8 s | 8.3 s | 13 s | 0.02 % |
| **C** | after | **4 × (5+5)** | **358 / 259** | **98 ms** | **1.1 s** | **2.7 s** | **0.00 %** (1 of 62 344) |
| D (300 users, AI journeys on, fake model) | after | 4 × (5+5) | 118 / 104 | 12 ms | 70 ms | 620 ms | 0.46 %¹ |
| E (400 users, **the deployed shared API**) | after (deployed) | 2 × (10+20) | 155 / 123 | 29 ms | 610 ms | 1.1 s | 0.04 %² |

² all 8 were the load test being too strict: a new `presence` frame arrived
before `ready` on the live channel; the locustfile now accepts it. The API log
showed no worker recycling and no graceful-timeout during E.

¹ all 57 were kanban moves on cards another test suite deleted mid-run (see
"shared-database hazard" below); the locustfile now treats a vanished
throwaway card as not the API's failure.

Per endpoint, p50 / p95 / p99 in ms (failure rate):

| endpoint | A (before) | B (fixes, 2 workers) | C (fixes, 4 workers) |
|---|---|---|---|
| `GET /notifications/counts` | 2400/27000/36000 (0.06%) | 1700/7900/12000 (0.00%) | 110/1100/2800 (0.00%) |
| `POST /api/explorer/query [list]` | 2500/28000/37000 (0.05%) | 1900/8000/13000 (0.00%) | 160/1200/3000 (0.00%) |
| `POST /api/explorer/query [advanced]` | 2900/28000/41000 (0.00%) | 1800/8500/13000 (0.00%) | 150/1200/3100 (0.00%) |
| `GET /api/records/[type]/[id]` | 2400/28000/35000 (0.00%) | 1700/9000/14000 (0.00%) | 110/1100/2800 (0.00%) |
| `GET /api/search/global` | 2700/27000/36000 (0.00%) | 1800/8500/14000 (0.00%) | 120/1100/3100 (0.00%) |
| `GET /dashboard/summary` | 5100/32000/44000 (0.00%) | 4500/13000/18000 (0.00%) | 250/1800/4500 (0.00%) |
| `POST /api/explorer/insights` | 4800/31000/43000 (0.00%) | 3500/13000/18000 (0.00%) | 140/1700/5100 (0.00%) |
| `GET /api/kanban/boards/[id]` | 2400/28000/37000 (9.32%) | 1800/7900/13000 (0.00%) | 100/980/3300 (0.00%) |
| `POST /api/kanban/cards/[id]/move` | 1800/25000/32000 (32.32%) | 1700/6500/9800 (0.38%) | 130/1000/2800 (0.24%) |
| `GET /api/calendar/events` | 3200/30000/36000 (0.00%) | 2000/8200/11000 (0.00%) | 230/1300/2600 (0.00%) |
| `GET /api/files` | 2400/31000/36000 (0.00%) | 1800/7700/12000 (0.00%) | 110/1100/4100 (0.00%) |
| `POST /exports/estimate` | 2200/26000/33000 (0.00%) | 1600/5900/8600 (0.00%) | 66/820/2000 (0.00%) |
| `WS /live [connect]` | 7900/15000/19000 (32.24%) | 1700/8600/10000 (2.80%) | 13/1400/2600 (0.00%) |
| **all** | 2300/25000/35000 (1.22%) | 1800/8300/13000 (0.02%) | 98/1100/2700 (0.00%) |

Full per-run summaries are committed as `loadtest/reports/*_SUMMARY.md`; the
HTML and CSV reports stay local (git-ignored).

After every run `cleanup.py` removed the throwaway boards, cards, exports and
the run's own audit and request-log rows, then diffed the row count of every
table against a snapshot taken before: **"database consistent: nothing the load
test writes is left behind"** for every run.

## What was in the way, and what changed

**1. Every request wrote the caller's `users` row.** `core/auth._sync_user` set
`last_login_at = now()` on each authenticated request, so each request was an
`UPDATE users … WHERE id = :me`. With 200 simulated users per persona, all of
one person's in-flight requests queued on that row's lock; Postgres showed
42–56 *active* connections (all waiting) during run A, and 1–4 in run B. Now it
is written at most once a minute, the same rule `user_sessions.last_seen_at`
already followed. Also: the role that `_sync_user` already loads is reused
instead of queried again (one statement less on every request).
→ `backend/src/core/auth.py` (`_sync_user`, `_permissions_for`); pinned by
`tests/perf::test_a_request_does_not_write_the_users_row`.

**2. Both gunicorn workers retired together, and took 30 s to do it.**
`max_requests = 2000 ± 200`: at ~100 req/s per worker both reached it within a
second of each other every ~20 s. A retiring worker stops accepting and waits
`graceful_timeout` (30 s) for its open requests, and the open live websockets
never finish on their own. So the API answered **nothing** for ~30 s at a time
(the RPS graph of run A drops to 0–1 req/s for 40 s, twice). Now:
`max_requests = 50000 ± 25000` (a leak is still capped; workers never retire
together), and `post_worker_init` closes a retiring worker's live sockets with
1012 (service restart) the moment it stops being alive, so the browser
reconnects to the other worker and polls meanwhile.
→ `backend/gunicorn.conf.py`; pinned by `tests/chaos/test_websocket_chaos.py`.

**3. CPU: two workers are not enough for 1000 users.** With 1 and 2 fixed,
run B was CPU-bound: two gevent workers serve ~170 req/s, and the 1000-user mix
asks for ~330. Four workers (run C) carry it with p95 ≈ 1 s. Each worker's pool
only needs 5 + 5 connections: active Postgres connections never went past a
handful once the lock queue was gone, and 4 × 10 = 40 stays well inside
`max_connections = 100` beside everything else. **Recommended for the stack:
`WEB_CONCURRENCY=4`, `DB_POOL_SIZE=5`, `DB_MAX_OVERFLOW=5`** (in
`loadtest/docker-compose.loadtest.yml`; `docker-compose.yml` still says 2 × (10+20)).

**4. N+1 on every sharable list.** Saved searches, reports, report documents
and dashboards each fetched their audience (`resource_shares` ⋈ `users`) one
row at a time: 18 extra queries for the seeded saved-search drawer.
`core/sharing.prefetch_members` loads a page's audiences in one query and
`members()` reads from it. Saved searches 30 → 9 statements, reports 15 → 11,
dashboards 14 → 9. → `backend/src/core/sharing.py` and the four list functions.

Looked at and left alone: **indexes**. `pg_stat_user_tables` after the runs
shows sequential scans only where they are the right plan. orders, tickets and
tasks (≤ 800 rows) are aggregated whole by the dashboard and insights, where a
scan beats an index. `announcement_receipts` (695 rows) has an index on every
column it is filtered by, plus the unique `(announcement_id, user_id)`, and the
planner still prefers scanning so few rows. No migration was warranted. Re-check
`seq_tup_read` if the seed scale grows by an order of magnitude. **The request log**: one
`INSERT INTO system_logs` per request is a real cost (a transaction per
request), but batching it would delay what `/admin/logs` shows; at four workers
it was not the limit. **Principal caching**: four statements per request
resolve the caller. Caching them would make permission changes and session
revocation lag, which `core/auth` promises not to do.

## Statement budgets (no N+1)

`make test-perf` (`backend/tests/perf/test_query_budgets.py`), against the
seeded database:

* **34 endpoint budgets.** Each key endpoint sends at most N statements for one
  request (today's count plus a little headroom). Every authenticated request
  costs 5 before its handler runs (user, role, groups, session, request log);
  `test_auth_overhead_is_constant` pins that floor. Today's counts: `/favorites` 6,
  `/api/me` 9, `/notifications/counts` 10, explorer list 12–14, insights 17,
  record detail 6, global search 13, saved searches 9, `/admin/organizations` 15.
* **14 "flat in the page size" checks.** A list asked for 2 rows and for 100 rows
  must send the same number of statements, which is the definition of "no N+1".
* The once-a-minute session touches are excluded from counts so a budget never
  depends on the clock.

## Frontend

**Bundle budget** (`make bundle-budget`, `loadtest/frontend/bundle-budget.mjs`),
gzipped, production build of master:

| | size | budget |
|---|---|---|
| initial load (entry script + CSS) | 421.9 kB | 465 kB |
| largest lazy chunk (`index-*.js`, the charting vendor chunk) | 339.4 kB | 375 kB |
| next: `queryTree` 220 kB, `pdf` 105 kB, `WorldMap` 57 kB, `Table` 47 kB | | |
| total JavaScript | 1757 kB | 1950 kB |

The budgets are today's sizes plus ~10 %. They catch a heavy import landing in
the entry chunk, which is the regression that matters.

**Page metrics** (`make web-vitals`, `loadtest/frontend/web-vitals.mjs`):
Playwright, cold cache per page, 1440×900, signed in as admin, against the
stable production build on **:8090** (gzip, immutable caching). The same
browser APIs Lighthouse reads (LCP, layout-shift, longtask). Times in ms; JS is
bytes on the wire:

| page | TTFB | FCP | LCP | TBT | CLS | JS |
|---|---|---|---|---|---|---|
| /home | 7 | 40 | 276 | 1 | 0.123 | 442 kB |
| /dashboard | 8 | 44 | 380 | 23 | 0.093 | 934 kB |
| /tasks | 7 | 40 | 212 | 14 | 0.036 | 540 kB |
| /tickets | 6 | 36 | 1552 | 85 | 0 | 610 kB |
| /explore | 6 | 32 | 280 | 34 | 0 | 955 kB |
| /kanban | 8 | 40 | 304 | 11 | 0 | 568 kB |
| /files | 7 | 32 | 1536 | 18 | 0 | 556 kB |
| /find/global | 7 | 32 | 168 | 1 | 0 | 439 kB |
| /admin/audit | 6 | 32 | 1536 | 11 | 0 | 561 kB |
| /notifications | 7 | 40 | 1544 | 0 | 0 | 447 kB |

Every page is within the budget (LCP ≤ 2.5 s, TBT ≤ 300 ms). With a 4× slower
CPU (`THROTTLE=4`, a mid-range laptop) the data-heavy pages go over the TBT
budget: /dashboard 609 ms, /tickets 789, /explore 654, /kanban 418 (/home 203).
That is rendering the antd table and chart trees on the main thread.

Follow-ups worth doing (frontend owners):
* /tickets, /files, /admin/audit and /notifications share an LCP of ~1.54 s on
  an otherwise fast load. The constant suggests a delayed entrance animation or
  a skeleton swapped for the table at a fixed point, not data.
* CLS on /home (0.12) and /dashboard (0.09) is just over/near the 0.1 "good"
  line: tiles that size themselves after their data arrives.
* Under a slow CPU the list and chart pages block the main thread for
  0.4–0.8 s; virtualising long tables and deferring off-screen charts would help.

## The shared-database hazard

The backend suite's cleanup (`tests/conftest._remove_what_the_test_created`)
deletes every row in its list of tables created after the test started, by
anyone. Run against the shared dev database while other people (or a load test)
are writing, it deletes *their* rows: the load test's throwaway kanban board
and cards vanished mid-run this way, twice. Worth knowing before running
`make test-backend-db` against a database somebody is using; the load test now
tolerates it.
