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
| `src/core/` | db, errors, pagination, query, rules, cache, auth, audit, correlation, clock |
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
```

MinIO's console is at <http://localhost:9001> (`nucleus` / `nucleus-dev-secret`).

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
Two commands close that, both additive and neither destructive:

```bash
python -m src.seed --check          # is the schema behind the model, and does the data hang together
python -m src.seed --sync-schema    # add the columns that can be added, with their indexes and keys
python -m src.seed --sync-roles     # give the built-in roles any newly declared permissions
python -m src.seed --sync-reports   # make saved reports the analysis compiler would reject runnable
python -m src.seed --sync-automations  # make automations the engine cannot run runnable
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

Under Compose these are `make check-seed`, `make sync-schema`, `make
sync-roles`, `make sync-reports` and `make sync-automations`.

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

**Error handlers are installed twice, on purpose.** Flask-RESTX handles
exceptions inside `Resource.dispatch_request`, so an `@app.errorhandler` alone
never sees anything raised by a mounted endpoint.

---

## Documentation

| | |
| --- | --- |
| [`docs/TODO.md`](docs/TODO.md) | Implementation tracker, updated after every task |
| [`docs/RBAC.md`](docs/RBAC.md) | Authentication flow, role/access matrix, groups and enforcement rules |
