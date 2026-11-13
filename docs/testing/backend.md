# Backend tests: one command, the live stack, nothing left behind

```bash
make test-backend-cov      # every backend test + line & branch coverage, fails under 95 %
```

That is the whole suite — unit tests, the tests that need PostgreSQL, Redis
and MinIO, the query budgets (`tests/perf`) and the fault injection
(`tests/chaos`) — against the running stack (`make up`). It prints a
term-missing report and writes `backend/htmlcov/`. The narrower targets still
exist: `make test-backend` (no services; the `database`/`cache` tests skip),
`make test-backend-db`, `make test-perf`, `make test-chaos`.

Without make:

```bash
cd backend
TEST_DATABASE_URL=postgresql+psycopg2://platform:platform@localhost:5433/platform \
TEST_REDIS_URL=redis://localhost:6380/0 \
STORAGE_ENDPOINT=http://localhost:9000 STORAGE_PUBLIC_ENDPOINT=http://localhost:9000 \
STORAGE_ACCESS_KEY=nucleus STORAGE_SECRET_KEY=nucleus-dev-secret \
.venv/bin/python -m pytest --cov=src --cov-fail-under=95
```

`backend/.coveragerc` measures `src/` with branch coverage on; the gate is the
combined line + branch figure coverage.py reports as `TOTAL`.

## The suite shares the demo database — and undoes exactly what it did

The tests read the seeded world (the five personas, their records, boards,
mailboxes) the way the app does, so they run against the stack's own
`platform` database. A transaction rolled back around each test is not
available: the code under test opens and commits its own sessions, which is
part of what is being tested.

So every test runs inside an **undo log** (`tests/undo_log.py`, wired by the
autouse fixture in `tests/conftest.py`):

* every INSERT this process sends is recorded by table and primary key, read
  from the statement's own parameters — ORM flushes, bulk inserts and Core
  upserts alike, on every table — and those rows are deleted at teardown,
  children before parents (a refused delete is retried after the others);
* before every UPDATE or DELETE, the rows it is about to touch are read on the
  same connection, plus whatever an `ON DELETE CASCADE`/`SET NULL` foreign key
  will take with them, and the first version seen of each is kept; teardown
  writes each back if it differs (re-inserting it if it is gone);
* writes made by module- or session-scoped fixtures are undone when the
  session ends.

A row another process wrote meanwhile — the end-to-end suite, a load test,
somebody using the app — is in neither list and is never touched. The run ends
with one line, e.g.

```
undo log: removed 48875 rows the suite inserted, put back 7982 it changed; 0 could not be undone
```

and a test that leaves something the log cannot reverse (in practice: a
seeded row left pointing at a row the test created) fails its teardown with the
row named.

The capture reads through the raw DBAPI cursor, below SQLAlchemy's events, so
the statement counts in `tests/perf` are not affected.

**What it replaced:** a hand-kept list of tables from which teardown deleted
every row newer than the test's start — by anyone. It deleted load-test
fixtures and e2e scratch data, needed an entry for every new model, and
restored nothing a test changed (a full run trimmed the admin's recents and
deleted seeded assistant conversations).

### Destructive tests use their own database

Seeding, migrations and `--check`/`--sync-*` drift tests drop tables, so they
run in a per-process scratch database (`<db>_scratch_<pid>`,
`nucleus_migrations_check_<pid>`) that is dropped afterwards — two suites
running at once cannot reseed or drop each other's.

## Writing a test

* Mark anything that touches PostgreSQL `@pytest.mark.database` (Redis:
  `cache`); unmarked tests must pass with no services at all
  (`make test-backend`).
* Sign in as a seeded persona with `tests/personas.py`:
  `sign_in(monkeypatch, "analyst")` for headers, `as_each(monkeypatch)` to
  switch persona per request, `principal(app, "user")` to call a service
  directly. Claims carry the personas' real names (`conftest.PERSONA_NAMES`),
  so signing in never renames anybody.
* Assert what the code guarantees, not the shared database's current state:
  other people use the same database (toggling flags, reading mail). Assert
  what the seed *writes* by generating it (`runner.generate(...)`), and
  compare relative to rows the test created.
* Make your own rows rather than editing seeded ones where you can; when you
  must edit seeded data, the undo log restores it — but a test whose meaning
  depends on another test having run first is a bug.
* External services are faked in-process: the LLM (`LLM_MODE=fake` /
  scripted `llm` fakes), storage (`LocalStorage` under `tmp_path`), Keycloak
  (`verify_token` patched), failure modes in `tests/chaos/conftest.py`.

## Coverage

`# pragma: no cover` is reserved for genuinely unreachable/defensive lines and
must say why on the same line.

Where it stands (2026-11-13, `make test-backend-cov`): **96.0 %** combined —
97.5 % of lines, 91.1 % of branches — up from 92.4 % (94.7 % lines, 84.6 %
branches) when the gate was introduced.

| package | lines | branches | combined |
|---|---|---|---|
| `src/api` | 99.5 % | 97.9 % | 99.3 % |
| `src/core` | 97.6 % | 93.3 % | 96.6 % |
| `src/models` | 99.8 % | 91.7 % | 99.8 % |
| `src/seed` | 96.4 % | 90.5 % | 94.9 % |
| `src/services` | 97.3 % | 90.6 % | 95.6 % |

The largest remaining gaps are single defensive branches spread across the
big modules (`services/automation_graph`, `workflows`, `relationships`,
`seed/runner`) rather than untested features.
