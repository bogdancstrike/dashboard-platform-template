<p align="center">
  <img src="docs/logo.svg" alt="Nucleus" width="340">
</p>

An enterprise application template platform: the screens, patterns and plumbing
that every internal business application ends up needing, built once so the next
project starts at week six instead of week zero.

Nucleus is a **template**, not a product. It is meant to be forked, renamed and
filled with real entities. Everything in it is chosen to be the version you
would have had to write anyway — a filter bar that filters in PostgreSQL, an
audit trail that commits in the same transaction as the change it records, a
permission catalogue that the admin screen is generated from.

> Status: backend foundations, data model and API runtime are complete and
> tested. The endpoint surface, the seed and the frontend are in progress — see
> [`docs/TODO.md`](docs/TODO.md) for exactly where the line is.

---

## What is here

```
backend/     Flask + Flask-RESTX API on the QF framework, SQLAlchemy 2, PostgreSQL 18
frontend/    Vite + React + TypeScript + AntD + ECharts + RAQB + cmdk
keycloak/    Realm export: roles, clients, demo users
docs/        Architecture notes and the implementation tracker
```

### Backend layout

| Path | What lives there |
| --- | --- |
| `maps/endpoint.json` | **The API surface.** QF mounts every endpoint from here |
| `src/config.py` | Every runtime knob, read once from the environment |
| `config.py` | Top-level shim — QF hard-codes `config.Config` |
| `src/core/` | db, errors, pagination, query, rules, cache, auth, audit, correlation, logsink, clock |
| `src/models/` | 49 tables across identity, business, content, personal and platform |
| `src/api/` | Request handlers, plus the loader that checks the endpoint map |
| `src/services/` | Domain services the handlers compose |
| `src/seed/` | Deterministic demo data |
| `tests/` | pytest suite; runs with no database present |
| `Dockerfile` | Two-stage build; `CMD gunicorn -k gevent -c gunicorn.conf.py wsgi:application` |

### Frontend layout

| Path | What lives there |
| --- | --- |
| `src/theme/tokens.ts` | **The design tokens.** The AntD theme, the CSS custom properties and the ECharts theme all derive from this one file, so the three cannot drift |
| `src/theme/AppearanceProvider.tsx` | Light / dark / system and the three density modes, applied to AntD and the stylesheet together |
| `src/api/client.ts` | Correlation id on every request, `ApiError` from the error envelope, cancellation, bearer injection |
| `src/test/` | MSW handlers and the provider-wrapped render helper |

### Extending dashboards and record previews

`/dashboard` displays 16 panels backed by PostgreSQL aggregates. Add a panel
in `backend/src/services/dashboard.py`, declare its key in
`frontend/src/api/dashboard.ts`, and use a builder from
`frontend/src/components/charts/options.ts`. The shared chart card supplies
the theme, table view and CSV export; additional dimensions belong in
`charts/data.ts` so downloads retain the values shown by the chart. Label
current-state snapshots explicitly when they do not follow the period picker.

`/explore?resource=ticket&record=<uuid>` opens a complete record beside the
results. Preview data comes from `/platform/api/records/<type>/<uuid>` and is
independent of visible columns. Declare prose fields through `Resource.content_fields`
in `backend/src/services/explorer.py`; keep those fields in the resource's field
catalogue. The detail contract also includes structured `metadata`, with known
secret keys masked recursively. Text is rendered as escaped prose, preserving
paragraphs. Related records use the existing schema-derived relationship API.

### Files, and where the bytes live

`/files` never moves bytes through the API. A browser asks for a presigned URL
(`POST /api/files`), PUTs straight at object storage, and then confirms
(`POST /api/files/<id>/confirm`) — where the API checks the object arrived with
`stat` rather than believing the client. A download is a presigned GET the
browser follows itself.

`backend/src/core/storage.py` publishes one interface with two
implementations: `ObjectStorage` for anything S3-compatible (MinIO in the
compose stack) and `LocalStorage` for a directory, so `python main.py` works
with nothing else running. `GET /platform/health/status` reports **which store
is answering** — the local one streams every byte through this process, which
is fine on a laptop and worth knowing anywhere else.

Storage keys are generated, never built from a filename. The name a person gave
a file is metadata in PostgreSQL.

```bash
make sync-files    # write the object bytes every seeded file points at
make sync-exports  # write the file every seeded export claims, and make its counts describe it
```

MinIO's console is at <http://localhost:9001> (`nucleus` / `nucleus-dev-secret`).

### Exports, and what happens when one is too big for a response

Every list exports the **question**, not the page: the same statement the list
endpoint built, minus its `LIMIT`. Below 50 000 rows (20 000 for a workbook,
which a zip container forces) the file streams back in the response.

Above that, a download would have to hold a request open past a proxy timeout,
so the API **refuses rather than truncating** — for a long time it applied the
ceiling as a SQL `LIMIT` instead, which handed somebody 50 000 rows of a
200 000-row export with a `200` on it and nothing to indicate the file was a
fragment. The refusal carries `queue_instead: true`, and every list's Export
control turns that into an offer: one press produces the whole set in the
background and it appears on `/exports` with a real file.

There is no worker in this stack and `backend/src/core/background.py` does not
pretend there is one. It runs the work off the request *inside the API
process* and names which of three mechanisms did it — a **greenlet** under
gunicorn, a **thread** under `python main.py`, or **inline** when a test asks
for determinism. Which one ran is on the row and on the page, because
"background" hides three quite different things. Swapping in a real queue is a
change to that module and to nothing above it.

Two consequences worth knowing. In-flight work is lost when the process
restarts, so a queued export that nothing will ever pick up is a state this
platform genuinely produces: `/exports` derives **stalled** from how long a row
has been pending, says so instead of spinning forever, and offers to ask the
question again. And an export's file is a copy of production rows in object
storage, so `retention.export_days` bounds how long it lives, the bytes are
dropped the moment an expired one is asked for, and a download is checked
against the person who requested it — administrators included, who can run the
query themselves and leave an audit entry in their own name.

Letting one go takes two presses, the same rule `/mail` uses for a thread: the
first `DELETE` removes the file, the second removes the record. The two acts
are different sizes — one takes a copy of production data out of object
storage, the other tidies away somebody's own note — and the audit trail keeps
the history of both, where the requester cannot edit it.

### Adding a chart kind, and putting records on the map

A chart kind is three declarations: a builder in
`frontend/src/components/charts/options.ts`, an entry in `ChartKind`
(`frontend/src/api/dashboard.ts`), and a row in
`frontend/src/components/charts/shapes.ts` saying what the picture *needs* —
how many groupings, how many measures, whether the first must be a date. The
chart builder reads that last one to offer every kind and refuse the ones the
current question cannot feed, by name. Add the string to `VISUALIZATIONS` in
`backend/src/services/reports.py` so a saved analysis may name it; a test
asserts the two lists stay one list.

`/maps` joins records to places through a gazetteer in
`backend/src/core/geography.py` — the cities this dataset uses, with their
coordinates — rather than through a latitude column. The seed draws its cities
from the same list, so a city that can be generated is a city the map can
place. Which datasets can be mapped, and how each reaches a place, is the
`MAPPABLE` table in `backend/src/services/maps.py`; a dataset whose own row has
no city is placed one hop away, at its customer's. Country outlines are
vendored (`frontend/src/assets/README.md`) because the stack runs offline.

---

## Running it

### Docker

```bash
cd backend
docker build -t nucleus-api .
docker run --rm -p 5101:5101 \
  -e DATABASE_URL=postgresql+psycopg2://platform:platform@host.docker.internal:5432/platform \
  nucleus-api
```

### On the host

```bash
cd backend
python -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
pip install dist/qf-1.0.5-py3-none-any.whl

# A database to point at
docker run -d --name nucleus-pg -p 5432:5432 \
  -e POSTGRES_USER=platform -e POSTGRES_PASSWORD=platform -e POSTGRES_DB=platform \
  postgres:18-alpine

python main.py                                    # development
gunicorn -k gevent -c gunicorn.conf.py wsgi:application   # production
```

### Keeping an existing database in step

`create_all` creates the tables that are missing and says nothing about a table
that already exists but has since grown a column in the model — so the failure
arrives as a 500 on somebody's next write rather than as an error on deploy.
The commands below close that. Every one of them is additive and none is
destructive — they insert what is missing and repair what no longer fits, and
never drop or overwrite a row somebody may have edited:

```bash
python -m src.seed --check          # is the schema behind the model, and does the data hang together
python -m src.seed --sync-schema    # add the columns that can be added, with their indexes and keys
python -m src.seed --sync-roles     # give the built-in roles any newly declared permissions
python -m src.seed --sync-reports   # make saved reports the analysis compiler would reject runnable
python -m src.seed --sync-automations  # make automations the engine cannot run runnable
python -m src.seed --sync-mailboxes    # give each demo persona an inbox worth opening
python -m src.seed --sync-settings     # add newly declared settings, refit any that no longer fit
python -m src.seed --sync-jobs         # top every background-job status up to its guaranteed minimum
python -m src.seed --sync-org          # recount each department's headcount from the people in it
python -m src.seed --sync-exports      # write the file every seeded export claims, and correct its counts
```

`--sync-schema` refuses to guess: a `NOT NULL` column with no default is
reported with the reason rather than added, because deciding what existing rows
get is a migration somebody has to read.

`--sync-reports` exists for a defect worth knowing about if you seeded before
it was fixed: the generator used to draw a report's groupings and measures from
a literal list of column names, none of which any dataset declares, so every
saved report failed the moment somebody opened `/reports`. It is derived from
the resource declarations now, `--check` reports any row that is still wrong,
and this repairs them — seeding refuses to touch a populated database, and
rightly.

`--sync-automations` is its sibling and exists for the same reason: the seeded
automation rules used to compile their conditions against a hand-made field
list and to watch three datasets the explorer has never declared, so every one
of them was unrunnable — and a monitoring rule that cannot run reports quiet,
which reads exactly like good news. It repairs what it can and *pauses* a rule
whose dataset is gone, because there is nothing to repair that to.

`--sync-settings` is the one you will need most often while extending the
platform, because it is the one a new *feature* triggers: `/admin/settings`
renders every control from the setting's declaration, so adding a setting means
adding a row to `seed/catalog.py`, and a populated database will not have it.
It inserts what is missing and refits any stored value that no longer satisfies
its declaration — a bound that has since tightened, a choice that has since
been removed — because a setting whose value its own control cannot represent
is one the page silently rewrites the first time somebody opens it.

`--sync-mailboxes` is the fourth of these and the least dramatic: the mailbox
generator's folder draw is random, and at the small scale it left the
*administrator* — the account everybody signs in as first — with two threads
and neither of them in the inbox. An empty inbox on a demo reads as a broken
feature. It counts what is there and inserts only what is missing.

`--sync-jobs` is the one the *test suite* wears out — which is why `make e2e`
depends on it, so the sweep provisions the fixture it is about to spend. `/admin/jobs` builds its
filters from `JOB_STATUS`, and RETRYING is weighted at 0.04 — so at the small
scale the draw leaves it empty about half the time, and a console offering a
filter that can never match anything is the same defect an empty kanban lane
was. The end-to-end suite then spends these: it retries a job, and a retry
spends an attempt irreversibly, because `attempt` is a record of what happened
and nothing rewrites it. So there are two guarantees rather than one — at least
three jobs per status so no filter is dead, and at least one per status still
*within its attempts* so there is something to retry. The second is the one
that ran dry: topping up by row count alone kept finding five cancelled jobs
and never noticed every one of them had spent its attempts. If the jobs spec
starts saying "run 'make sync-jobs'", that is what it means — and `make e2e`
does it for you. `make e2e-only` is the suite without the top-up, for when you
want to see the guard fire.

`--sync-org` is the only one of these that *edits* rather than inserts, and it
is safe precisely because what it edits is derived. `departments.headcount` was
drawn at random before the users existed, so Support stored 116 people with
nobody at all assigned to it — two numbers for one fact, and the stored one was
the fiction. `users.department_id` is the truth, `services/organizations` counts
it rather than reading the column, and this stops the cached copy contradicting
it. `--check` reports the drift, so a database that has it says so.

`--sync-exports` is the other one that edits, and it is the most thorough of
them because the rows it repairs were wrong in four ways at once. A seeded
export said `{"rows": 184203, "artifact": "exports/JOB-000004.csv"}` for bytes
nobody had written; `rows` was a progress counter over a `total_units` drawn at
random up to 250,000; the extension was `.csv` whatever the payload's format
said; and the payload named an `entity` no code could resolve, so not one
seeded export could describe its own query. This runs the *real* export for
each one — the same `services/exports.produce` a request runs — so the
artefact, its size, its checksum and the unit counts all describe a file that
exists. It also gives every persona holding `records.export` one finished
export, because a page whose every download fails demonstrates nothing. If a
download on `/exports` 404s, that is what it means.

Under Compose these are `make check-seed`, `make sync-schema`, `make
sync-roles`, `make sync-reports`, `make sync-automations`, `make sync-mailboxes`,
`make sync-settings`, `make sync-jobs`, `make sync-org` and `make sync-exports`.

Then:

| URL | |
| --- | --- |
| <http://localhost:5101/> | Swagger UI |
| <http://localhost:5101/swagger.json> | OpenAPI document |
| <http://localhost:5101/platform/health/live> | Liveness (never touches a dependency) |
| <http://localhost:5101/platform/health/ready> | Readiness (503 until the database answers) |
| <http://localhost:5101/platform/health/status> | Every dependency, with latency |
| <http://localhost:5101/platform/meta/routes> | The API surface this process is serving |
| <http://localhost:9001> | MinIO console — `nucleus` / `nucleus-dev-secret` |

### Frontend

```bash
cd frontend
npm install
npm run dev        # http://localhost:5174, proxying /platform to the backend
npm run build      # typecheck, then bundle
npm run test       # vitest + React Testing Library + MSW
```

The dev server proxies `/platform` rather than talking to the API
cross-origin, so development exercises the same request path production uses
behind a reverse proxy — no CORS preflight that only exists on a developer's
machine, and no API URL compiled into the bundle.

Nothing environment-specific is baked in at build time. The Keycloak realm, its
public URL and the SPA client id are fetched from `/platform/meta/app` at
startup, which is what lets one built image run in staging and production.

### Tests

```bash
cd backend && python -m pytest
cd frontend && npm run test
```

The suite runs with **no database, cache or Keycloak present** — dependencies
are pointed at a closed port so they are refused in a millisecond rather than
timing out. Tests that genuinely need PostgreSQL are marked `database` and skip
unless `TEST_DATABASE_URL` is set:

```bash
TEST_DATABASE_URL=postgresql+psycopg2://platform:platform@localhost:5432/platform \
  python -m pytest
```

---

## Adding an endpoint

The API surface is `backend/maps/endpoint.json`. QF's router
(`framework.api.dynamic`) builds every Flask-RESTX resource from it, so adding
an endpoint is two steps:

1. **Write the handler.** QF's calling convention, in a module under `src/api/`:

   ```python
   def my_endpoint(app=None, operation="", request=None, **path_params):
       return {"hello": "world"}, 200
   ```

2. **Declare it in the map:**

   ```json
   {
     "namespace": "platform",
     "operation_name": "my_endpoint",
     "model_name": "Empty",
     "request_method": ["GET"],
     "api_url": "/things/<uuid:thing_id>",
     "description": "What it does.",
     "exec_method": { "module_name": "src.api.things", "method_name": "my_endpoint" }
   }
   ```

The namespace is the URL prefix — QF mounts a namespace at `/{name}` — so
`platform` is what puts the route at `/platform/things/…` and why the namespace
name matches `API_PREFIX`.

Check it without booting the app:

```bash
python -m src.api.endpoint_map
```

That imports every handler the map names and prints the surface. The same check
runs at startup, so a typo in a handler reference is a process that refuses to
boot rather than a 500 the first time somebody calls the endpoint.

---

## The decisions worth knowing

**Keycloak owns identity; Nucleus owns authorization detail.** The realm proves
who you are and which role you hold. The `roles` table turns that role into a
permission set, which is what makes the roles-and-permissions admin screen a
screen that changes real behaviour. Code asks *"may this principal export
records?"*, never *"is this an admin?"*.

**Two Keycloak URLs, and the distinction is the point.** Signing keys are
fetched over the internal network (`keycloak:8080`); the issuer is validated
against the public address the browser actually used (`localhost:8080`).
Collapsing them breaks either the container-to-container fetch or the issuer
check.

**Filtering happens in PostgreSQL.** A client that filters a page it already
downloaded is filtering 25 of 200,000 rows while presenting the answer as if it
covered all of them. Each endpoint declares its columns once as a `FieldSet`,
and the simple filter bar and the advanced query builder compile to the same
operator vocabulary — so they can never disagree about what "starts with" means.

**The cache is an optimisation, never a dependency.** Every helper in
`core/cache.py` degrades to a miss when Redis is unreachable, and readiness does
not fail on it. A dashboard that 503s because a *cache* is down is worse than
one that recomputes.

**Liveness touches nothing.** A liveness probe that checks the database restarts
a healthy API every time the database hiccups, turning a brief outage into a
crash loop.

**Gevent workers, and psycopg2 patched to match.** The API spends its life
waiting on PostgreSQL, which greenlets handle for a few megabytes where threads
would cost a stack each. `psycogreen` is what makes psycopg2 yield instead of
blocking in libpq — without it the server gets *slower* as concurrency rises.

**UUID primary keys, generated in PostgreSQL.** Shareable in URLs without
leaking row counts, and the seed can build a whole interconnected graph before a
single INSERT.

**Audit rows commit with the change they describe.** `core/audit.py` takes the
caller's session rather than opening its own — otherwise a rolled-back update
leaves an audit entry claiming it happened.

**The request log is the deliberate opposite, for the same reason.**
`core/logsink.py` writes one `system_logs` row per API request in a session of
its *own*, after the response: the rolled-back request is precisely the one
worth having a line for, and sharing the transaction would delete the evidence
along with the cause. Two rules that look contradictory and are not — an audit
row is *part of* the change, a log line is a *report about* it.

That log is what makes a correlation id useful rather than decorative. Every
response carries `X-Correlation-ID`, every failure payload repeats it, the
frontend prints it on its error screens — and `/admin/logs` finds the request
by it. The level is derived from the outcome (`>=500` ERROR, `>=400` WARNING, a
slow success WARNING too) so that "show me the errors" is a question with one
answer, and health probes and the log endpoints themselves are excluded, since
a table that grows while somebody looks at it has a tail that never settles.
Nothing there can fail a request: the write is wrapped at both the callee and
the `teardown_request` boundary, because an exception in a teardown hook
propagates out of the request context and fails a response that had already
succeeded.

One consequence to expect: the table grows with use, and running the
end-to-end suite adds a few thousand lines of the suite's own traffic. That is
the feature working rather than a leak — `retention.log_days` bounds it, and
"Apply retention" on `/admin/logs` enacts that bound on demand for anybody
holding `settings.manage`. If a demo database has become noisy, the level chips
and the correlation-id search are what cut through it.

**Error handlers are installed twice, on purpose.** Flask-RESTX handles
exceptions inside `Resource.dispatch_request`, so an `@app.errorhandler` alone
never sees anything raised by a mounted endpoint.

---

## Documentation

| | |
| --- | --- |
| [`docs/TODO.md`](docs/TODO.md) | Implementation tracker, updated after every task |
| [`docs/RBAC.md`](docs/RBAC.md) | Authentication flow, role/access matrix, groups and enforcement rules |
