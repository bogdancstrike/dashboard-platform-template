# Edge cases and security quick-pass

`backend/tests/chaos/test_api_edges.py` (87 cases, run by `make test-chaos`),
plus a manual probe of the live API with every seeded persona. The rule: odd or
hostile input is a **4xx with the error envelope**, never a 500 and never a
slow query. Somebody else's private thing, asked for by id, is a 404 or 403,
never the thing.

## Found and fixed

| bug | before | after | where |
|---|---|---|---|
| NUL byte in a search term (`a\u0000b`) | 500 (psycopg2 refuses NUL) | 400 `validation_error`, without echoing the statement | `backend/src/core/errors.py` (`database_rejected_input`), which covers every text input, not just search |
| comment on a record that does not exist (`00000000-…`, a deleted ticket) | **201**: an orphan comment stored | 404 | `backend/src/services/comments.py` (`_require_record`) |
| two saves of the same version (`expected_updated_at`) | both succeeded when within 1 s of each other, or when simultaneous: the second silently overwrote the first | the row is locked (`SELECT … FOR UPDATE OF`) and versions must match to 1 ms; exactly one of four simultaneous saves wins, the rest get 409 `conflict` | `backend/src/services/record_writes.py` |
| database out of range values (`DataError`) | 500 | 400 | `backend/src/core/errors.py` |

## Checked and fine

**Pagination.** `page_size` 0, −1, 201, 100000, `page=abc` / `1e9`, `order=sideways`
→ 400 on every list. `page=-5` is clamped to 1; `page=999999999999` returns an
empty page quickly; an unknown or SQL-ish `sort` falls back to the default
order (whitelisted, never interpolated). Max page size is 200 everywhere.

**Rule trees and filters** (explorer and anything compiling `core/rules`).
Nesting is limited to 12 (13 → 400; 900 levels → 400 in 90 ms, no recursion
error). 200 rules at most (500 → 400). Unknown field, unknown operator, a
non-date for a date, a non-number for a number, `children1` of the wrong type
→ 400 with a message naming the problem. Filters with SQL-ish values
(`OPEN' OR 1=1--`), NoSQL-ish objects (`{"$ne": 1}`) and unknown keys are bound
parameters or ignored, never executed. `columns: ["password"]` → 400. Bodies
that are not a JSON object (`[1,2,3]`, `"string"`, invalid JSON, 5000 `{`) → 400.

**Text.** SQL-ish strings, `%`/`_`/`\` wildcards, RTL, emoji and CJK search
and round-trip intact (kanban board name test). Search terms over 500
characters → 400; URLs over gunicorn's request-line limit are refused by
gunicorn (400).

**Uploads.** Upload tickets refuse over 512 MB (`MAX_UPLOAD`), refused
extensions (`.exe`), empty names and negative sizes. The stored object key is
generated server-side; a name like `../../etc/passwd` is only display metadata,
and `core/storage.key_for` rejects `..` segments as a second line of defence.

**Permissions across personas (IDOR)**, probed live as `user` against admin's
private kanban board, dashboard, saved search, report, notification, mail
thread, session and files: read, update, delete, transfer and run → **404 or
403 every time**. Admin surfaces (`/admin/audit`, `/admin/logs`, roles,
settings, log prune, user edit, impersonate) → 403. `X-Impersonate-User` from a
non-admin is ignored. By design and not a leak: `user` (VIEWER) holds
`users.view` and `files.view`, so the user directory and the organisation's
files are readable.

**Rate limits.** AI: `LLM_RATE_PER_MINUTE` per person (services/ai.guard → 429),
`LLM_MAX_CONCURRENCY` per worker (→ 503 busy). Sign-in: Keycloak's brute-force
protection (realm setting), which is why the load test signs each persona in
once. There is no general per-user API rate limit on bearer-token traffic; the
`api_clients.rate_limit_per_minute` column describes machine clients and is
not enforced on browser sessions. Noted as a gap, not changed.

## Not done here

* No fuzzing of every write endpoint. The probe covered explorer, search,
  files, comments, kanban, exports, records and calendar; the rest share
  `auth.json_body` and the same validators.
* Pre-existing, not fixed: `tests/test_report_documents.py::test_a_chart_block_asking_for_numbers_alone_gets_no_picture`
  needs PostgreSQL but has no `database` marker, so `make test-backend` (no DB)
  fails it on master.
