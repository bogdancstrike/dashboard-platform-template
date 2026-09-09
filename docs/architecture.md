# Architecture

The picture is [`architecture.svg`](architecture.svg): four lanes, three stores,
the identity provider, the live channel, and the ten numbered steps a request
takes. This is the prose that goes with it — what the layers are, which way the
dependencies point, and why the framework is wired the way it is. Where a claim
here is checked by something, the something is named; a document that describes
a shape nothing enforces is true on the day it is written.

## The shape

One browser, one origin, one API process, and the stores behind it.

```
browser ──► nginx (frontend image) ──► gunicorn + gevent (api image) ──► PostgreSQL
                    │                          │                        Redis
                    │                          ├──────────────────────► MinIO / S3
                    └── /platform/* proxied ───┘                        Keycloak
```

**Same origin, deliberately.** The bundle calls `/platform/...` relative, nginx
proxies that prefix to the API, and the browser therefore never issues a
cross-origin request: no preflight on every call, and no API address compiled
into the JavaScript. The same image runs in any environment and only
`NUCLEUS_API_UPSTREAM` changes. `frontend/nginx.conf` also forwards the two
headers a WebSocket upgrade needs — without them the handshake returns 200 with
an HTML body, the browser reports a generic failure, and the client quietly
falls back to polling: working, and a quarter as live as it looks.

**Gevent workers, not threads.** The API is I/O-bound — every request is a query
or an object-store call — so gunicorn runs greenlets and `psycogreen` patches
psycopg2 to cooperate with the loop. Without that patch one slow query blocks
every other request on the worker.

## Why the framework is wired this way

The API is built by a vendored framework wheel (`backend/dist/qf-*.whl`). QF's
`FrameworkApp.run()` creates the Flask app, attaches Flask-RESTX, and mounts
**every endpoint declared in `backend/maps/endpoint.json`** — the URL surface is
data, not decorators. `src/api/app.py` adds only what QF leaves to the
application: the correlation and CORS hooks, the request-log sink, and the error
handlers, in that order, because each depends on the one before it.

Two consequences worth knowing:

* **The map is checked before anything is served.** `python -m src.api.endpoint_map`
  runs at boot and in `make lint`, so a handler reference that does not resolve
  refuses to start the process rather than surfacing as a 500 on first call.
* **The map is the contract with the frontend.** `frontend/src/api/contract.test.ts`
  reads `endpoint.json` and asserts that every address the client calls is one
  the API mounts. The two halves of this repository used to agree by hand.

Error handlers are registered on both the app *and* the Api object: Flask-RESTX
catches exceptions inside `Resource.dispatch_request`, so an `@app.errorhandler`
alone never sees anything raised by a mounted endpoint.

## Four layers, and which way they point

```
api/       handlers: a permission, a transaction, a call, a status code
services/  the decisions: one module per subject, session and principal in
core/      the mechanisms: query, pagination, auth, audit, storage, export, …
models/    the schema, and nothing else
```

The rule is that imports point **inwards only**, and `backend/tests/test_layering.py`
asserts it module by module:

* **`api/` holds no logic.** A handler names its permission (`@requires`), opens
  `session_scope()`, calls a service and returns what it said. It may not query:
  a query in a handler is a rule living outside the service that owns it, and
  the list endpoint would then be able to answer differently from the export
  that is supposed to be the same question. The test fails on `select(` or
  `session.execute(` anywhere under `src/api/`.
* **`services/` know nothing about HTTP.** They take a session and a principal
  and raise typed errors from `core/errors.py`. A service that reached for
  `flask.request` could not be called by the seed, by the importer, or by
  another service — and all three of those call services.
* **`core/` knows nothing about a dataset.** `query.py` compiles filters for a
  declared `FieldSet`, `pagination.py` counts and envelopes, `sharing.py` decides
  visibility, `storage.py` signs URLs. The moment one of them imports a service
  it has an opinion about tickets, and the next dataset needs a second copy.
* **`models/` import nothing of ours.** They are the one description of the
  schema, read by `create_all`, by the migrations, by the repair and by every
  service; a model that imported a service would make the schema depend on
  behaviour.

`seed/` sits outside the layering and may read all of it: it is a tool, not a
layer.

## What a request does

The numbered path on the diagram, in words:

1. **nginx** serves the SPA or proxies `/platform/*` to the API.
2. **A correlation id** is assigned (or adopted from the caller's header) and
   echoed on the response. Every log line and every error screen carries it, so
   the id a reader can copy is one `/admin/logs` can find.
3. **The token is verified** against Keycloak's published keys — RS256, with the
   JWKS cached and refetched when an unknown `kid` appears, which is how key
   rotation heals itself rather than causing an outage.
4. **The permission is checked** by the decorator on the handler. A refusal names
   the permission it wanted, in the same words the disabled control in the UI
   uses (§76).
5. **`session_scope()` opens one transaction** for the request. The service does
   its work inside it — including `core.audit.record(...)`, so there is no state
   in which a change exists and its audit entry does not.
6. **The service asks `core` for mechanisms** and the models for tables. Filters,
   sorting, faceting, paging and the export all compile to SQL from one field
   declaration per dataset, which is why a list and its export cannot disagree.
7. **Aggregates are computed in PostgreSQL**, never in the browser: the number in
   a list header is the whole dataset, not the page that was downloaded (§71).
8. **The response is enveloped** by `core/pagination.py`, so every list answers
   with the same shape and the client has one reader for all of them.
9. **The cache is invalidated by the write**, not by a timer: a transaction
   records which datasets it touched, and an `after_commit` hook bumps each of
   those datasets' cache generation, so every aggregate keyed on the old one is
   unreachable. *After* the commit, because bumping while the transaction is
   still open leaves a window in which another request recomputes from the
   pre-commit state and stores that answer under the new generation — stale, and
   now looking fresh. A five-minute TTL instead would tell the person who just
   closed a ticket that it is still open, and they are the one person guaranteed
   to notice.
10. **Bytes never pass through the API.** Uploads and downloads use presigned
    URLs, so a hundred-megabyte file never occupies a worker. The local-directory
    store signs its own links and serves them from `/api/files/blob`, which is
    public *because the signature is the credential* — a browser following an
    `<img>` cannot add a bearer header.

## The stores, and what happens without them

| | Required? | Without it |
| --- | --- | --- |
| **PostgreSQL** | yes | the API is not ready and says so; `/health/ready` fails |
| **Redis** | no | the cache disables itself after one refused connection, and the live channel falls back to per-worker delivery — correct, and only as live as the worker holding the socket |
| **MinIO / S3** | no | files fall back to the local directory, which signs and serves its own links |
| **Keycloak** | yes | nothing authenticates; `/meta/app` still answers, because the sign-in page cannot start without it |

The distinction between **liveness** and **readiness** is load-bearing:
`/health/live` never touches a dependency, `/health/ready` touches the ones a
request needs, and `/health/status` reports the rest with what each degrades to.
A dashboard that 503s because a cache is down is worse than a slow dashboard.

## The schema

The models are the description; everything else reads them.

* **`create_all` builds an empty database** on a first `docker compose up`,
  because needing two commands for a working stack is a worse first five minutes
  than owning a version table — and then **stamps** the current Alembic
  revision, so the database records what it is.
* **Alembic owns the change** after that. `backend/migrations/env.py` reads the
  models' own metadata, so a revision is generated from the ORM rather than
  typed beside it. `tests/test_migrations.py` asserts that after
  `alembic upgrade head` on an empty database, autogenerate finds *nothing* to
  do — which is the check that a model changed without a revision fails.
* **`--sync-schema` is the additive repair** for a database whose rows nobody
  has to think about: it adds columns that can be added, with their indexes and
  keys, and *reports* the ones that need a decision (a `NOT NULL` with no
  default) rather than guessing.

Constraint and index names come from one naming convention in
`models/base.py`, because a constraint PostgreSQL named `users_manager_id_fkey`
in one database and `..._fkey1` in another is a migration that works on one of
them.

## The frontend, in the same spirit

```
api/        one module per API surface; nothing else calls fetch
entities/   the contract the six lists share — URL state, chrome, saved views
components/ shared pieces; feature folders for the ones that only fit one page
pages/      layout and the subject's own decisions
theme/      tokens, and the two builders that turn them into AntD and ECharts
```

* **The URL is the state** (§72): filters, sort, page, period, tab and the open
  record all live in the address, so a view can be pasted to a colleague and a
  reload lands where the reader was.
* **Colour comes from tokens, never a hex at a call site.** `theme/tokens.ts` is
  the palette; `theme/contrast.test.ts` measures every ink against every ground
  in both appearances, so the contrast property holds for pages nobody has
  written yet.
* **Declarations, with tests that read the source.** The page-layout gallery, the
  create-shape classification, the record pages the palette can reach, the
  component inventory — each is one declaration asserted against the router or
  the sources, because a hand-kept list of pages is wrong by the third new page
  and then misleads everybody who reads it.

## What is derived rather than written twice

Everything in this list used to be, or would otherwise be, a second description
of something the system already knows:

| Artefact | Derived from |
| --- | --- |
| `docs/RBAC.md` | `core/auth.PERMISSION_GROUPS` |
| `docs/features.md` and the tracker's matrix | one catalogue in `scripts/render-features.py`, checked against the router and the endpoint map |
| `docs/WALKTHROUGH.md` | `scripts/render-walkthrough.py`, route-checked and walked by `e2e/walkthrough.spec.ts` |
| every list, filter, facet, sort and export | one `FieldSet` per dataset |
| the frontend's API surface | `backend/maps/endpoint.json`, asserted by `api/contract.test.ts` |
| the layer boundaries | `tests/test_layering.py` |
| the seeded world | one deterministic generator, `python -m src.seed` |

`make lint` runs the checks; `make docs` regenerates the documents.

## The standing rules

The ones that decide arguments, in the order they usually come up:

1. **The server decides.** Filtering, counting, aggregating and paging happen in
   PostgreSQL. A number computed in the browser is a number about the page.
2. **Declare once.** If two places describe the same thing, one of them will be
   wrong; the fix is to derive the second from the first, or delete it.
3. **Say what happened.** Every failure names what failed, what is missing in
   words, and the correlation id — and offers a retry only where retrying could
   work.
4. **Refuse visibly.** A control the reader may not use is disabled with the
   reason, not hidden. Hiding it teaches them the product is inconsistent.
5. **Every behaviour is asserted at the level that can catch it.** A rule about
   the sources is a source test; a rule about SQL is a database test; a rule
   about what a reader sees is a browser test.
