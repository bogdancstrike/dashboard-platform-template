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

Then:

| URL | |
| --- | --- |
| <http://localhost:5101/> | Swagger UI |
| <http://localhost:5101/swagger.json> | OpenAPI document |
| <http://localhost:5101/platform/health/live> | Liveness (never touches a dependency) |
| <http://localhost:5101/platform/health/ready> | Readiness (503 until the database answers) |
| <http://localhost:5101/platform/health/status> | Every dependency, with latency |
| <http://localhost:5101/platform/meta/routes> | The API surface this process is serving |

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
