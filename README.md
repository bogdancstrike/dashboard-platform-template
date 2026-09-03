# Nucleus

An enterprise application template platform: the screens, patterns and plumbing
that every internal business application ends up needing, built once so the next
project starts at week six instead of week zero.

Nucleus is a **template**, not a product. It is meant to be forked, renamed and
filled with real entities. Everything in it is chosen to be the version you
would have had to write anyway — a filter bar that filters in PostgreSQL, an
audit trail that commits in the same transaction as the change it records, a
permission catalogue that the admin screen is generated from.

> Status: backend foundations and data model are complete and tested. The API
> surface, the seed and the frontend are in progress — see
> [`docs/TODO.md`](docs/TODO.md) for exactly where the line is.

---

## What is here

```
backend/     Flask + Flask-RESTX API on the QF framework, SQLAlchemy 2, PostgreSQL 18
frontend/    Vite + React + TypeScript + AntD + ECharts   (not started)
keycloak/    Realm export: roles, clients, demo users
docs/        Architecture notes and the implementation tracker
```

### Backend layout

| Path | What lives there |
| --- | --- |
| `src/config.py` | Every runtime knob, read once from the environment |
| `config.py` | Top-level shim — QF hard-codes `config.Config` |
| `src/core/` | db, errors, pagination, query, rules, cache, auth, audit, correlation, clock |
| `src/models/` | 49 tables across identity, business, content, personal and platform |
| `src/api/` | Route table, endpoint-map renderer and request handlers |
| `src/services/` | Domain services the handlers compose |
| `src/seed/` | Deterministic demo data |
| `tests/` | pytest suite; runs with no database present |

---

## Running it

Nothing is containerised yet, so this is the host route.

```bash
cd backend
python -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
pip install dist/qf-1.0.5-py3-none-any.whl

# A database to point at
docker run -d --name nucleus-pg -p 5432:5432 \
  -e POSTGRES_USER=platform -e POSTGRES_PASSWORD=platform -e POSTGRES_DB=platform \
  postgres:18-alpine

python main.py
```

Then:

| URL | |
| --- | --- |
| <http://localhost:5101/> | Index — points at everything below |
| <http://localhost:5101/platform/docs> | Swagger UI |
| <http://localhost:5101/platform/health/live> | Liveness (never touches a dependency) |
| <http://localhost:5101/platform/health/ready> | Readiness (503 until the database answers) |
| <http://localhost:5101/platform/health/status> | Every dependency, with latency |
| <http://localhost:5101/platform/meta/routes> | The API surface this process is serving |

In production it is gunicorn with gevent workers instead:

```bash
gunicorn -c gunicorn.conf.py wsgi:application
```

### Tests

```bash
cd backend && python -m pytest
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

## The decisions worth knowing

**Routes are declared in Python, not JSON.** QF builds endpoints from a JSON
document. That is fine for a handful of worker endpoints and unworkable for a
hundred, so [`src/api/routes.py`](backend/src/api/routes.py) holds the table and
[`endpoint_map.py`](backend/src/api/endpoint_map.py) renders the JSON QF wants.
The generated file is never committed — a checked-in derived file is a file that
goes stale. Handlers keep QF's calling convention,
`handler(app, operation, request, **path_params)`.

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

**UUID primary keys, generated in PostgreSQL.** Shareable in URLs without
leaking row counts, and the seed can build a whole interconnected graph before a
single INSERT.

**Audit rows commit with the change they describe.** `core/audit.py` takes the
caller's session rather than opening its own — otherwise a rolled-back update
leaves an audit entry claiming it happened.

---

## Documentation

| | |
| --- | --- |
| [`docs/TODO.md`](docs/TODO.md) | Implementation tracker, updated after every task |
