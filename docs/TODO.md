# Implementation Tracker

Living checklist for **Nucleus**, the enterprise application template platform.
Updated after every task. Section numbers map to the requirement spec (§1–§77).

Legend: `[ ]` not started · `[~]` in progress · `[x]` done

---

## Contents

- [Where it stands](#where-it-stands)
- [Reference projects](#reference-projects)
- [How to use this tracker](#how-to-use-this-tracker)
- [Design foundations](#design-foundations)
- [Testing strategy](#testing-strategy)
- [Feature matrix (§1–§77)](#feature-matrix-1-77)
- [Phase 0 — Foundations](#phase-0--foundations)
- [Phase 1 — Backend core](#phase-1--backend-core)
- [Phase 2 — Data model](#phase-2--data-model)
- [Phase 3 — Seeds](#phase-3--seeds-57)
- [Phase 4 — Backend API](#phase-4--backend-api)
- [Phase 5 — Frontend foundation](#phase-5--frontend-foundation)
- [Phase 6 — Frontend pages](#phase-6--frontend-pages)
- [Phase 7 — Verification](#phase-7--verification)

---

## Where it stands

| Area | State |
| --- | --- |
| Backend core (`src/core/`) | **done** — db, errors, pagination, query, rules, cache, auth, audit, correlation, clock |
| Data model (`src/models/`) | **done** — 49 tables, builds on PostgreSQL 18 (499 indexes, 113 FKs) |
| API runtime | **done** — QF mounts from `maps/endpoint.json`, Swagger at `/`, Dockerfile with `gunicorn -k gevent` |
| Endpoints | 62 of ~110 — `maps/endpoint.json` is the list, and `python -m src.api.endpoint_map` prints it; nothing here is kept in step by hand |
| Seed (`src/seed/`) | **done** — 15 454 rows, deterministic, `--check` verifies referential consistency |
| Tests | 363 backend + 295 frontend + 149 Playwright e2e — all green against `docker compose up`. Scale-independent: they pass on either seed size |
| Frontend | shell, Data Explorer, discovery workspaces, the notification centre, six entity lists, three record pages of their own, and the whole ANALYSE section bar dashboards; live WebSocket channel with a polling fallback |
| Compose stack | **done** — `docker compose up` reaches a working stack: PostgreSQL, Redis, Keycloak, MinIO, the API and the SPA. Real Keycloak tokens and real presigned uploads verified |

**Backend and frontend are built in parallel from here**, in vertical slices: an
endpoint ships together with the page that consumes it and the tests for both.
No phase is "all of the backend, then all of the frontend".

---

## Reference projects

Four existing projects on this machine set conventions worth following, especially design, features, architecture, technologies, components, dashboards, charts, docker-composes for third-parties, integrations, etc:

| Project | Path | What to take from it                                                                                                                                                                                                                                                                                                                                  |
| --- | --- |-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **gif_responder** (gifr) | `/home/bogdan/workspace/dev/gif_responder` | The QF wiring that Nucleus already follows: committed `maps/endpoint.json` as the API surface, `FrameworkApp` with dynamic endpoints, `wsgi.py` monkey-patching gevent at import, two-stage Dockerfile. Also the **`cmdk` command palette** (`frontend/src/components/CommandPalette.tsx`) — grouped, keyboard-driven, debounced entity search ; Also Advanced Search, Saved Searches, vector searches, etc       |
| **tickora** | `/home/bogdan/workspace/dev/tickora` | The **audit explorer** shape: `src/api/audit.py`, `src/audit/{service,serializers}.py`, `frontend/src/pages/AuditExplorerPage.tsx` and `components/common/AuditTimeline.tsx`. Filter vocabulary (actor, action, entity type/id, correlation id, date range) and the per-entity timeline. Nucleus's `AuditLog` is a superset of tickora's `AuditEvent` |
| **scraper_b2_stealth** | `/home/bogdan/workspace/dev/scraper_b2_stealth` | Long-running job orchestration and operational logging patterns — relevant to §23 background jobs and §22 log streaming                                                                                                                                                                                                                               |
| **dentnow-react** | `/home/bogdan/workspace/dev/dentnow-react/dentnow-react` | React application structure and component conventions                                                                                                                                                                                                                                                                                                 |

- [ ] Read each before starting the corresponding area.

---

## How to use this tracker

Every item carries **acceptance criteria** — the conditions under which it may be
ticked, written so someone who did not do the work can check it. "Looks right"
is not a criterion; "the list returns 25 of 200 000 rows and the SQL contains
the filter" is.

### Definition of done

An item is `[x]` only when all of these hold:

1. **It works against real data** — the seeded database, not three fixtures.
2. **It is tested at the right level** — see [Testing](#testing-strategy).
   New endpoint → integration test. New pure function → unit test. New
   user-visible flow → e2e test.
3. **The whole suite passes**, backend and frontend, with no new skips.
4. **All six data states exist** (§34) — see [States](#states-every-data-view-must-have).
5. **Keyboard-reachable and screen-reader-labelled** (§54, §55).
6. **Deep-linkable** (§69) and **state-persistent** (§72) if it is a view.
7. **Docs updated** — this file, plus `README.md` if running or extending changed.
8. **Committed and pushed.**
9. **Frontend and backend redeployed after every task**, then verified against
   the running Compose stack with health probes and browser tests. Record the
   checks and any remaining limitations here; never mark unverified work done.

### Engineering standards

These are not aspirations; they are the review criteria. A change that fails
one of them is not finished, however well it works.

- **Clean code, and code that reads as prose.** Names say what a thing is, not
  what type it is. Functions do one thing at the level of abstraction their
  name implies. No dead code, no commented-out code, no "temporary" branch that
  outlives the sprint.
- **SOLID where it earns its keep**, not as ceremony. One reason to change per
  module; extension by declaration (a `Resource`, a `Field`, a row in
  `endpoint.json`) rather than by editing a switch; depend on the narrow
  interface, not the concrete class.
- **DRY, but not at the cost of clarity.** Two things that look alike and
  change for different reasons are two things. The generic list page is shared
  because the *query contract* is genuinely one thing; the entity pages are not
  shared, because a kanban board and a fleet monitor are not one thing.
- **YAGNI.** No abstraction for a second case that has not arrived.
- **Documented code.** Every module opens with a docstring saying what it is
  for and *why it is built the way it is* — the alternative that was rejected
  and the reason. Comments explain decisions, never restate the line below
  them. A reader should be able to reconstruct the reasoning without the
  commit history.
- **Derived, never duplicated.** The relationship map comes from the schema's
  foreign keys, the permission matrix from the code's permission catalogue, the
  field catalogue from the `Resource` declarations. A second, hand-kept
  description of something the system already knows is wrong the first time
  anybody changes it.
- **Every behaviour is asserted at the level that can actually catch it.**
  Pure logic → unit test. Endpoint → integration test against the seeded
  database. User-visible flow → Playwright against `docker compose up`.
- **Errors carry a correlation id, and refusals say which permission is
  missing.** A screen that fails silently, or that hides a control instead of
  explaining it, is a bug (§34, §76).

---

## Requested this session (2026-09-06)

Everything asked for today, so nothing is lost between sittings. Each becomes a
vertical slice with its own tests, its own tracker entry and its own commit.

- [x] **Relationships is a graph-analysis page drawn with D3** (§50) — force
      layouts, communities detected server-side, entity map and ego network all
      on the same D3 component
- [x] **Records must stop looking alike** (§7, §8) — six entities, six
      genuinely different pages. The **lists** differ: `/tasks` a board,
      `/projects` a portfolio timeline, `/customers` an account grid,
      `/orders` a ledger, `/tickets` a split triage queue, `/devices` a fleet
      monitor. The **details** now differ too, where the record has a shape of
      its own: `/tasks/:id` a work page, `/projects/:id` a delivery review,
      `/tickets/:id` a support console. `/customers/:id`, `/orders/:id` and
      `/devices/:id` keep the declaration-driven page, deliberately — a page
      that is only ever *read* is better served by the field catalogue than by
      a layout somebody invented for it
  - **`/projects/:id` answers one question**: *are we all right*. Not in any
    single column — in the gaps between how much of the schedule has gone, how
    much of the money has gone and how much has been delivered. Three gauges
    and a sentence naming the gap, then the work underneath. The seeded
    portfolio has a project at 85% delivered on 119% of its budget, which is
    exactly the finding a table of three numbers hides
  - **The rollup is `POST /api/analysis/run`**, not a count in the browser.
    "How many tasks are in each state" is *group these rows by this column*,
    which the platform compiles once (§71); counting the eight rows the page
    downloaded would give a number that silently means "of the eight I have".
    Every lane links into `/tasks` already filtered, because a board exists
    and a second one embedded here would be a second definition of a lane
  - **`/tickets/:id` is ordered the way the work is**: the SLA standing first,
    because it decides whether this is the next thing anybody does; the
    conversation widest, because answering is the action; triage beside it,
    writing on change. Whether the SLA was *missed* is read from the record —
    a page recomputing that rule would disagree with every report ever run
  - **The half the three share is a hook, not a layout.** `useRecordPage`
    holds what they cannot differ on — which record is open, what a failure
    says, and what it means to write one field with the version that was read
    (§73). Written three times, "what does a stale edit do" would have three
    answers and two of them would be wrong
  - Both consoles read fields that were not declared: a ticket's
    `first_response_at`, `resolved_at`, `reopen_count`, `customer_id`; a
    project's `customer_id`, `completed_at` and `currency`. Declared once, so
    they reach the explorer, the catalogue and the detail together rather than
    through a second endpoint with its own permission story
  - **Two pure functions, unit-tested against a fixed clock**
    (`entities/delivery.ts`, `entities/sla.ts`). The cases that matter are
    boundaries — a project with no budget, one already closed, a ticket
    resolved after its deadline, one nobody has answered — and each is one
    assertion rather than a rendered page somebody has to read
  - Verification: 310 backend tests on live PostgreSQL, 253 frontend tests
    (13 new here, plus 17 for the two pure functions), typecheck, lint and the
    endpoint-map check clean, FE/BE rebuilt and redeployed, and 130 Playwright
    tests green — including seven new ones proving the rollup reconciles with
    the server's own total, that a health and a severity written from either
    page survive a reload, that an analyst is refused in place, and that both
    pages are axe-clean in both themes
- [x] **`/notifications` should look better** (§17) — a digest strip that is
      also the filter, rows grouped under the day they arrived on, unread as a
      tinted card rather than bold text alone
- [x] **`/settings/preferences` persists through the backend** (§40) — saved
      server-side and applied automatically on the next visit, from any
      browser
- [x] **`/dashboard` needs far more charts** (§2, §44) — the full ECharts
      vocabulary, following `gif_responder`'s dashboard and going beyond it
- [~] **`/explore` needs a record side panel** (§64) — click a row and read the
      record itself: metadata, full text, related items. `rag-poc`'s data
      explorer is the reference
  - Fetch the complete record independently of visible table columns; show
    article-style text, labelled metadata, timestamps and related records.
    Preserve the search, make the selected record shareable in the URL, and
    support keyboard opening, closing, loading, missing and failed records.
  - Implemented: `record=<id>` deep links, dedicated detail reads, declared
    prose fields, order notes, labelled attributes and structured metadata,
    lazy related-record links, keyboard preview/Escape, and correlation-aware
    retry/missing/forbidden states. Extension metadata masks nested secret keys.
  - Local verification: 247 backend tests on PostgreSQL, 188 frontend tests,
    typecheck, endpoint-map validation and lint pass (14 existing warnings).
    Deployed verification found and fixed low-contrast secondary text, links and
    filled status badges in the preview. Text now uses the shared readable
    tokens; status colour is carried by badge borders. Heading levels follow
    the page hierarchy. The full browser suite is being rerun before completion.
- [x] **Expand `/dashboard` using Apache ECharts**, informed by
      `/home/bogdan/workspace/dev/gif_responder` and extending its examples:
      meaningful charts and statistics from real backend data, readable table
      alternatives, downloads, light/dark support and responsive layouts.
  - Shipped 16 panels across 14 kinds: line, area, vertical/horizontal bars,
    donut, multi-line, vertical/horizontal stacked bars, funnel, gauge, heatmap,
    scatter, radar and treemap. Snapshots are labelled separately from period
    totals; CSV/table views retain scatter coordinates and grouped dimensions.
    Names are escaped in HTML tooltips and spreadsheet formulas neutralized in
    downloads. Empty SLA samples show no data; funnel stages are nested and
    ticket resolutions use `resolved_at`. Dashboard APIs require `records.view`.
  - Verification: 243 backend tests (live PostgreSQL), 181 frontend tests,
    typecheck and lint (no errors; existing warnings), production Compose build,
    and 13 deployed browser tests covering real canvases, CSV, persistence and
    shell smoke checks. Commit `db5763a` pushed to `origin/master`; FE/BE
    redeployed, health probes passed and the full 107-test browser suite passed.
- [x] **Clean, documented code is required for all today's work** — follow
      the engineering standards above: focused modules, clear naming, SOLID
      where useful, DRY, YAGNI, explicit API contracts, comments explaining
      decisions, and tests at the level that can detect each regression.
- [x] **Records can be written, not only read (§9)** — one declaration per
      dataset now yields create, edit and delete as well as the list and the
      detail, and `/tasks` is a board a card can actually be moved on
  - `POST /api/records/<type>` · `PUT` · `DELETE` on the same resource
    declaration the list, the filters and the detail already read. What a form
    may write is declared beside the fields (`Writable`), so the API accepts
    exactly what the form offers and refuses everything else by name
  - Values are coerced against the declaration: an enum against the vocabulary
    the filter menu is built from, a number against its declared bounds, a
    foreign key against the table the column's own `ForeignKey` names — so a
    dangling `assignee_id` is a 404 about the assignee rather than an
    `IntegrityError` surfacing as a 500
  - **An edit that lost a race is refused, not applied.** A client sends the
    `updated_at` it read; if the row has moved on, the write is a 409 naming
    both moments (§73). Two people dragging one card cannot silently discard
    each other's move
  - The human identifier is generated, never accepted: `TSK-00501` continues
    the seed's own sequence, from one shared formatter (`core/naming.py`), so
    a created record is indistinguishable from a seeded one
  - **Moving a card writes the record.** Optimistic, then reconciled — every
    lane refetches, because a lane total is an aggregate over the whole
    dataset and cannot be adjusted in the browser without lying about the rows
    nobody loaded. A refused move snaps back and says why
  - Dragging is not the only way: `Move to` on every card is the same call
    from the keyboard (§54, §55), and the menu names the lanes
  - The edit form is **derived**, not written per entity: kind → control,
    vocabulary → select, bounds → spinner, foreign key → a picker that
    searches the dataset the schema says it points at. It sends only what
    changed, plus the version it edited, and guards a close that would discard
    unsaved edits (§74)
  - Refusals are shown, not hidden: an analyst sees Edit and Delete disabled
    with the permission named, and the board says it is read-only (§76)
  - Verification: 265 backend tests on live PostgreSQL (18 new), 196 frontend
    tests (8 new), typecheck, lint and the endpoint-map check clean, FE/BE
    rebuilt and redeployed, and 4 new Playwright tests green against the
    compose stack — a card moved between lanes survives a reload, the move is
    on the record's own history as a status change, an edit round-trips
    through the server, and an analyst finds the controls disabled
- [x] **Every page gets CRUD, not only reads** — all six list pages create,
      edit and delete, not only read
  - The lifecycle is one hook (`useRecordEditing`), not six: create, the edit
    drawer, the delete confirmation and the cache invalidation live together,
    and each page decides only *where* the control goes. A board puts it on the
    card, the ledger in a narrow last column, the triage queue beside the open
    ticket. Six drawers would be six definitions of what a task is editable in
  - The record is fetched when the drawer opens rather than taken from the row.
    A list carries the columns it draws; a form built from those would offer
    whichever fields that page happened to select
  - Every control is shown and disabled with the permission named when the role
    lacks it, on every page, because the capability comes from the catalogue
    the page already reads (§76)
  - Verification: a parameterised test asserts all six pages offer create, edit
    and delete — a page that quietly stayed read-only fails it. 202 frontend
    tests, typecheck and lint clean, FE redeployed and the full 114-test
    Playwright suite green
- [x] **The `ANALYSE` pages** — `/analytics`, `/reports`, `/reports/builder`,
      `/charts/builder`, `/maps` and `/dashboards` all ship
  - **One compiler, not four endpoints.** `POST /api/analysis/run` takes
    *group these rows by these columns and measure them this way* — the
    question the workspace, both builders and the map all ask. Four endpoints
    would be four places for "last 30 days" to be decided differently
  - Everything comes from the declaration: a dimension must be a declared
    field of a groupable kind, a measure a declared numeric one, and the
    filters go through the same `apply_filters` and `compile_tree` every list
    uses. `GET /api/analysis/catalog` publishes exactly what can be asked, so
    the builder cannot offer a column the compiler will reject
  - Aggregated in PostgreSQL, and the **totals are computed separately** from
    the grouped rows rather than summed from them — an average of averages is
    not an average, and a collapsed tail would be missing from it
  - **The tail is named, never dropped.** Twelve of forty industries are drawn
    and the rest become one "Other" row, so the parts still add up to the
    total beside them. A time series is exempt: its rows are buckets that read
    in order, and folding the oldest months into "Other" is a hole in the line
  - `/analytics` holds one context — dataset, period, grouping, granularity,
    measure and chart kind, all in the URL (§69, §72) — and every panel reads
    it. Clicking a value leaves for that entity's own page, filtered (§44)
  - **`/reports` is a list of questions and one answer**, not a gallery of
    names: pick a report, read its result. Running one hands the *stored
    definition* to the same compiler, so a report and the screen it was built
    on cannot disagree about the same data
  - **`/reports/builder` previews what it will save.** Every control writes
    into one draft, the draft is the preview query, and the preview query is
    what is stored — there is no step in between that could reinterpret it.
    The draft lives in the URL, which is what lets the analytics workspace's
    "Save as a report" hand its context straight over
  - **Sharing is `core/sharing`**, extracted from the saved-search service and
    now used by both: private by default, shared with named members, public,
    and only the owner writes. One mechanism, one table, one set of rules —
    saved views (§46) and dashboards (§45) adopt it with a string
  - Verification: 25 backend tests (live PostgreSQL) covering the compiler's
    contract, the refusals, the reconciliation and the report lifecycle;
    13 frontend tests asserting the shared period, the URL round-trip, the
    drill-down, the preview-is-what-is-saved property and who may act on
    somebody else's report; 5 Playwright tests proving the numbers are the
    database's, that a report built in the browser survives a reload, and
    that a private one is invisible to a colleague
  - One deployed bug this found and fixed: `DELETE /api/reports/<id>` echoed
    the route's `UUID` back unconverted, which is a 500 *after* the delete has
    committed — a request that reports failure having succeeded. A test now
    asserts the response body, not only that the row went
- [x] **The sidebar's collapsed state is a preference** (§1, §40) — stored on
      the account beside theme and density, so it follows the reader to another
      browser rather than living only in this one's localStorage
  - The field and the settings control already existed; what was missing is
    that *collapsing the sidebar itself* wrote nothing. It does now
  - Only an explicit toggle writes. The responsive collapse on a narrow window
    is a consequence of the window, and storing it would mean resizing a
    browser silently changed a setting
  - The localStorage fast path stays, so the first paint after a reload does
    not flash an expanded sidebar before the profile arrives
  - **Acceptance**: met — an e2e test collapses it, opens the account in a
    browser context with no storage at all, and finds it collapsed there
- [x] **Two real contrast failures fixed on the way** (§55) — links and the
      selected tab were left to AntD's derivation, which lands on #6666d4 in
      light mode (4.47:1 against an off-white panel) and #6c6cd3 in dark
      (3.75:1 at 13px). Both are now named from the accent ramp: 5.4:1 and
      6.5:1. Found by the axe assertion on the record preview, which is what
      that assertion is for
- [x] **Four more, found by pointing axe at a whole page rather than a
      drawer** (§55) — all four were product-wide, and none was visible to
      anybody looking at the screen
  - `Typography type="secondary"` is the most-used text style in the product
    and was left to AntD's derivation: `#64748b` on the page background is
    4.34:1, a tenth of a point short of legible. `colorTextDescription` is
    now named — 6.9:1 light, 7.6:1 dark
  - A **filled status tag** puts white on the status colour, and AntD picks
    that white without measuring: 2.9:1 on the amber this platform uses for
    "warning", 3.3:1 on its green. `StatusTag` moves the colour to a rule down
    the leading edge instead — same vocabulary, same hue, and the word beside
    it can be read
  - In dark mode a **Delete button's label** was the derived `#be2323` at
    2.94:1, and a **primary button** was white on `#6c6cd3` at 4.45:1. Both
    named: 6.5:1 and 5.4:1
  - `SEMANTIC` is tuned for *fills*, where the bar is 3:1; small text has to
    clear 4.5:1 and the fills do not. `SEMANTIC_INK` is the same four meanings
    at a readable lightness, per theme, so nothing gets a worse bar to make a
    caption legible and nothing gets an illegible caption to match a bar
- [x] **Two rendering bugs the screenshots caught** — an audit entry read
      "Ada Administratorjust now", because `nu-timeline-head` was a class name
      nobody had written a rule for; and a progress bar had no accessible name,
      so a screen reader announced a number with no subject
- [x] **A running database can be brought up to the model, additively** — found
      because it had to be: every audited write in the deployed stack had been
      failing with a 500 since `audit_logs` gained `impersonator_id`, and
      `create_all` is silent about a table that already exists but has drifted
  - `src/seed/schema.py` reads the drift out of the same `MetaData` the ORM
    maps, so a column added to a model is one this knows about the same day. A
    hand-written ALTER script is a second description of the schema, wrong the
    first time anybody forgets it
  - Additive, and it stops at anything that is not: a nullable column arrives
    with its index and its foreign key; a NOT NULL one with no default is
    *reported*, with the reason, because deciding what existing rows get is a
    migration somebody has to read
  - `python -m src.seed --sync-schema` applies it, `--check` reports it, and
    the seed's boot path warns rather than silently altering somebody's
    database. Alembic (below) is still the real answer; this is what closes
    the common case until it arrives
  - **Acceptance**: met — four tests against a scratch table on live
    PostgreSQL, and the deployed stack now answers 201 to the write that was
    answering 500

- [x] **Three test suites stopped depending on the seed's scale** — the seed
      offers `--scale small` and four assertions were written against the full
      one, so they failed for a reason they were never about. Each now compares
      against what the dataset itself reports: the analysis matches the
      ledger's own total, the export is bigger than the page it came from, the
      filtered directory is smaller than the unfiltered one

## Requested this session (2026-09-07)

In the order they were asked for, so nothing is lost between sittings. Each
becomes a vertical slice with its own tests, its own tracker entry and its own
commit — built, committed, pushed, redeployed and verified before the next.

- [~] **Files, imports and exports go through MinIO with presigned URLs**
      (§20, §29, §30) — MinIO in the compose stack with its bucket created on
      first boot, one storage interface behind it so it is swappable, and bytes
      that never pass through the API process
  - `/files` ships on it. The import wizard (§29) and the export-as-a-job flow
    (§30) are next, and both now have somewhere to put the bytes
- [ ] **Redis is used for what a cache is for** — the aggregates that cost a
      `GROUP BY` over the whole dataset, invalidated by the writes that make
      them stale rather than by a timer
- [x] **The dashboards *look* like QSINT's too** — the grid was not the part
      that was wrong
  - **The landing state is a gallery of cards, not a picker.** What a reader is
    choosing between is not a name — it is a layout — so each card carries the
    widget kinds it holds. "Alerts, revenue, a heatmap" is recognised far
    faster than "7 widgets", and a select in a header gave the choice one line
    of the page and made every dashboard look identical
  - **Creating one is a wizard** (§10): name it, fill it, check it. Three
    separate thoughts, and a single form asking all three at once gets a worse
    answer to each. The middle step is a grid of kind cards with counters —
    following QSINT — because "how many headline numbers" is a real question a
    checkbox cannot answer, and four across the top is the commonest dashboard
    there is
  - **It cannot be finished empty**, and the widgets arrive *with* it in one
    request, laid out by the same rule the grid's compaction uses. A create
    flow that ends on an empty grid has stopped one step short
  - **An unconfigured widget is a legitimate state, not an error.** The wizard
    picks *shapes*; each is given its subject on the grid it will live on.
    Requiring a dataset up front would mean choosing thirteen datasets in a
    modal before seeing a single card. The card says so in place, with the
    action (§34) — a panel that looks like a failure and is only unfinished
    sends somebody debugging
  - **Creating opens a wizard, editing opens a drawer**, and the difference is
    the point: a wizard makes a decision that has parts, a drawer edits an
    object that already exists
  - One vocabulary for the kinds (`components/dashboards/kinds.tsx`), read by
    the picker, the configure drawer and the gallery card. Two copies had
    already drifted — the drawer called a bar chart "Bar comparison" and the
    picker called it "Bars"
  - The kind select is searchable, because thirteen options is more than a list
    somebody reads top to bottom — and the ones past the window were
    virtualised away, which is how a test found it
- [x] **The dashboards follow QSINT** (`/home/user/workspace/qsint/frontend/ui-qsint`)
      — `react-grid-layout` with drag, corner resize and vertical
      auto-compaction; a "Tidy up" that applies the same rule on demand; and
      two widget kinds that draw what the reader already saved rather than
      asking them to describe it again
  - Four defects the deployed page then showed, all fixed: the seeded layouts
    *overlapped*, because the row advanced by the last widget placed rather
    than the tallest in it — so the grid had to push them apart and every
    dashboard opened full of holes; the seed wrote `TEAM` and `ORGANIZATION`
    scopes that `core/sharing` cannot express, making those rows invisible to
    everybody but their owner and unwritable by anybody; dashboards were owned
    at random, so no persona owned one and §67 could not be demonstrated; and
    the dashboard list spent a sixth of the page on four names, so the picker
    moved into the header strip
  - `python -m src.seed --check` now reports a scope the sharing model cannot
    express, because that failure is otherwise completely silent
- [~] **A UI/UX pass over every page** — cleaner and more minimalist, no large
      empty areas, uniform buttons and page furniture, everything easy to read
      and reach
  - Done so far: `/dashboards` rebuilt as a card gallery with a create wizard;
    widget cards fill the cell the grid gave them; a KPI's number fits one grid
    row without scrolling; `/files` lost a mostly-empty column and its drop
    panel became a strip, because a permanent element taking a third of the
    page pushes the files somebody came for below the fold
  - The pass over the remaining pages is still to come
- [x] **The collapsed sidebar keeps only its icons**, as QSINT's does
  - A group heading truncated to "OV…" is a word that has lost the letters
    that made it a word, and it costs a row of the rail to say nothing. The
    headings become thin rules instead, so the sections are still separated
  - AntD sizes a collapsed menu's item inset from its own `collapsedWidth`, so
    on a narrower rail the icon lands off-centre and the invisible label shoves
    it further. Re-centred on the rail, and the rail narrowed from 72px to
    56px — an icon needs no more
  - Asserted end to end, including that the icon's centre is within three
    pixels of the rail's
- [x] **The header sits on one centre line** — the profile trigger rode four
      and a half pixels above the three icon buttons beside it. `Space` centres
      its *items*, but an inline-level child inside one still sits on that
      item's text baseline, and a 40px-tall trigger next to 32px buttons had
      nothing to align to. The items became flex containers, which takes the
      baseline out of the question, and the trigger matches the buttons' height
- [~] **Pages fill their window** — one primitive rather than a patch per
      page. `.nu-content` was already a fixed-height scroll container, so
      `.nu-fill` claims the height that is left and `.nu-pane` makes a card's
      *body* the thing that scrolls. Three pages left two thirds of the window
      empty for the same reason: a workbench sized to its content puts the
      scrollbar on the whole page rather than on the column that is long
- [x] **`/files` stopped being three bars of chrome above one row**
  - The permanent drop panel is gone. The *list* takes the drop and says so
    only while something is over it; the permanent way to upload is a button
    in the header. A panel of instructions is read once and then occupies a
    tenth of the page forever — on a folder holding one file it was taller
    than the content
  - **Deleting a folder was the loudest control on the page**: a red button one
    slip away from a filter somebody types into all day. It moves behind the
    folder's own menu, and it is *refused in place with the reason* when the
    folder is not empty — which is the service's rule (a recursive delete of a
    tree is a mistake somebody makes once and cannot undo), previously
    discovered as a 409 after the confirmation had been agreed to
  - The open folder lives in the address (§69), so "look in /contracts" is a
    link. It was component state, which also made it untestable
  - What the whole store holds sits at the foot of the folder rail, where a
    list of thirteen short names left the column two thirds blank
  - The name column overlapped the one beside it, because AntD lays a table
    out `auto` until a column asks for fixed
- [x] **`/projects` is a table** — asked for directly, and right: the Gantt
      told a reader the *shape* of a project and refused to tell them a
      number. Two bars overlapping in March is a fact about capacity; which of
      the two is three weeks late and eleven points over its money is the fact
      somebody acts on, and no amount of hovering answers that for eight
      projects at once
  - Delivered, schedule used and budget used sit side by side as percentages,
    so the comparison the timeline was reaching for is read down a column
  - **The standing is derived, never stored** — by the same rule the delivery
    review uses (`entities/delivery.ts`), because two copies of "how far
    behind is too far" would be two answers
  - And it says *which* gap: every row read "Behind" on the seeded portfolio,
    which is a column carrying no information. `behindOn` distinguishes money
    from time from both — behind on money is a conversation with finance,
    behind on time one with delivery. Unit-tested against a fixed clock
  - The Gantt's 30 lines of CSS went with it; `.nu-timeline` stays, because it
    is the audit trail's
- [x] **`/tickets` is a table, and `/tickets/:id` says more** — asked for
      directly
  - The split view's right half was a *second rendering* of a record that
    already has a page: the same description, the same tags, the same history,
    maintained twice and slightly differently. It is gone, and a row opens the
    console
  - The queue was a list of coloured chips in a 380-pixel column, which is the
    one shape that cannot answer "which of these forty is worst". Now:
    severity, status, the clock, and a subject wide enough to read
  - **The service-level column is derived**, by the rule the console already
    uses (`entities/sla.ts`): "SLA breached · 3d 12h ago" rather than a
    `due_at` a reader has to subtract from today. Whether the promise was
    *missed* is still the server's `sla_breached` (§71)
  - Priority and channel became filters rather than columns, and the breach
    icon went: on a queue that is 84% breached, a marker on every row marks
    nothing. Same reasoning as the row tint, which was tried and removed
  - **The console shows what it had and never said.** The subtitle read
    "chat · data" — two words a reader has to guess at — and `project_id` was
    declared and shown nowhere. Both are labelled facts now, in a Filing
    panel, with satisfaction and the reopen count beside them
  - **How it has been handled** is the four moments a support desk is measured
    on, in sequence: raised → first answered → promised by → resolved. Four
    rows of a `Descriptions` table are four facts; in order they are the
    *shape* of the response, which is what a review of one looks at. The
    deadline says what it means ("Missed, and still open") rather than
    repeating the interval printed beside it
- [x] **Text contrast is a property of the palette, asserted as one** — axe
      caught a `Descriptions` label at 3.76:1 in dark, three commits after the
      colour was chosen, on the one page a spec happened to visit in the one
      appearance it happened to be in. `theme/contrast.test.ts` asserts every
      text ink in both appearances against both grounds — the page and a card
      — and immediately found a second: the light tertiary cleared 4.5:1 on a
      card and missed it on the page. It also asserts the ramp stays a ramp,
      because the easy way to fix a contrast failure is to flatten it
- [x] **`/reports`, `/reports/builder` and `/charts/builder` are cleaner** —
      asked for directly
  - **The question is one bar.** Both builders asked the same thing the same
    way and wrote it out twice: eight selects in a column, each with a bold
    label above it and a line of guidance below — seven hundred vertical
    pixels of form, two hundred lines of near-identical JSX, and the *answer*
    got what was left. `components/analysis/QuestionBar` reads as a sentence:
    `Orders · grouped by Status · measuring Sum of Total · over All time`. The
    label is a word in *front* of its control rather than a heading above it,
    which is what turns a three-row field into a one-row one, and the
    permanent hints became the label's tooltip
  - The copies had already drifted: "Then by" was "drawn as a stack" on one
    page and "a stack, a nest, a heatmap's columns" on the other, and only one
    was true for the page it was on
  - **Saving is a dialog from the header**, where a page's primary action
    belongs. It was a "Save it" card at the bottom of a column — on the chart
    builder, below an eight-field question *and* a thirteen-tile gallery, so a
    reader scrolled past everything they had just decided in order to record
    it. Also §10: a wizard where a decision has parts, a drawer for one
    object's fields, a plain dialog for one question — and "what shall I call
    this and who may see it" is one question
  - **The kind strip moved into the chart's own header, as icons.** Seven kind
    *keys* ("bar hbar line area pie stacked-bar treemap") in a segmented
    control overflowed its card and got cut off at "treemap"; the names are
    the API's keys rather than anything a person says, and how a thing is
    drawn is a property of the picture, not a ninth field of the question
  - **One message where the answer would be.** A card reading "Nothing in this
    period" above a banner reading "Bar needs a grouping" gives a reader two
    explanations, and only the second is true. `ChartCard` takes the reason
    from the caller who knows it
  - `/reports` fills the window: the list scrolls in its own pane, the answer
    grows into the space instead of sitting at 320 pixels with a third of the
    screen blank beneath it, and the provenance is one line rather than four
    stacked blocks above the chart
  - Private stopped being tagged on every row. A label every row shares is a
    label nobody reads, and it cost the row the space its name needed
- [x] **Every seeded report was unrunnable, and nothing said so** — found by
      taking a screenshot of `/reports`, which opened on "region cannot be
      grouped by"
  - The generator drew dimensions from a literal
    `("region", "status", "owner", "month", "segment", "channel")` and
    measures from `("count", "total", "average", "median", "sum")`. No dataset
    declares `region`, `owner` or `month`; `total`, `average` and `median` are
    not aggregations. So *every* saved report named something that does not
    exist and failed the moment it was opened — the first thing a reviewer
    does
  - Now derived from the resource declarations, using the same kinds the
    compiler uses to decide the same thing. A seed that invents identifiers is
    a seed that ships broken rows
  - **`--check` finds them** and **`--sync-reports` repairs them**, because
    seeding refuses to touch a populated database and the rows are already out
    there. The repair keeps what is valid, drops what is not, and falls back
    to the dataset's first groupable column with a row count
  - Two tests: every seeded report is accepted by the compiler's own rules,
    and the check actually *finds* a report built to be broken — a check that
    only ever runs against a good dataset is a check that passes whether or
    not it looked
- [x] **The health snapshot names the store even when it cannot reach it** —
      "unavailable" alone tells an operator that something is wrong and
      nothing about where to look. Found by running the backend suite without
      the storage environment, where the local fallback's directory is
      unwritable
- [x] **`/activity` is implemented** (§35, §48) — a feed is worth a page only
      if it can be *narrowed* faster than it can be read, and everything on it
      follows from that
  - **The strip is the filter**: one chip per kind, each carrying a count the
    server computed over the whole match. Counting the page would give a
    number that silently means "of the fifty I downloaded" (§71), and the
    counts do not move when a chip is chosen — a strip whose numbers change as
    you use it cannot be used to compare
  - Every kind is offered including the empty ones, refused rather than
    hidden: a chip that vanishes when nothing has happened teaches a reader
    that the platform has stopped recording it (§76)
  - **Not the audit trail.** `/api/audit/timeline` answers "what was done to
    *this record*, exactly" and the ledger behind `audit.view` is evidence —
    who, from which address, with which values before and after. This is
    "what has been going on" at `records.view`, and a viewer reads it while
    the ledger stays shut
  - **The sentence is the server's, printed whole.** The first version spliced
    the actor and the subject back out of it to re-assemble the line, and
    produced "updated the Viewer role Viewer" — because `core/audit` lets the
    code that records an event pass a sentence of its own. The row became a
    link instead: bigger to click than a word inside a line, and it cannot
    contradict the sentence beside it
  - `groupByDay` moved into `lib/time` — the notifications page had already
    written that loop and this would have been the third copy
  - **Two defects it exposed**, both product-wide: `_initials` was written
    twice on the server and the copies *disagreed* (the directory took the
    first and last words, the user endpoint the first two — "Ada Marie
    Administrator" was `AA` on one screen and `AM` on another); and an
    initials avatar's default ground carries white text at 1.84:1, so every
    avatar without a photograph was illegible
  - 8 backend tests, 7 component tests, 11 Playwright
- [x] **`/announcements` is implemented** (§17, §34) — the platform talking to
      the people using it
  - **Not a notification, and modelled as neither.** A notification is one
    person's: addressed, read once, gone. An announcement is a *notice* —
    written once for many readers, true for a window, and whether a given
    person has seen it is a fact about that person. So: the notice in
    `announcements`, the reader's side in `announcement_receipts`, written on
    the reader's *action* rather than at publish time (a row per reader up
    front grows with notices × people and makes editing a published notice a
    write to thousands of rows)
  - **"Live" is computed, never stored.** A `status` swept to `EXPIRED` by a
    job is wrong between sweeps, and the sweep is exactly the thing nobody
    notices has stopped
  - **The audience is what a reader *is*.** An empty `audience_roles` means
    everybody; a role code means anybody holding it. A notice addressed by
    enumerating recipients silently misses whoever joined after it was
    written — which for a maintenance window is the population that most
    needs it. Filtered in SQL: a page that downloaded it and chose not to draw
    it has published it to anybody with a debugger
  - **Reading and acknowledging are separate columns**, because "everybody has
    seen it" and "eleven people agreed to it" are different questions.
    Reading is recorded on arrival — the notice *was* on screen — and
    acknowledging takes a button that says what it commits the reader to
  - Two audiences on one route: a reader gets prose (what a maintenance notice
    *says* is why they opened the page), an author gets a table of states and
    reach (they are comparing twenty). One click apart, and the second is
    absent without `announcements.manage`
  - 15 backend tests, 12 component tests, 6 Playwright, and `--sync-roles`
    carries the new permission to existing installations
- [x] **A missing *table* can now be added without a destructive reseed** —
      `--sync-schema` reported one and refused to create it, advising "run the
      seed", which is advice a populated database cannot take. `CREATE TABLE`
      touches no existing row, so it belongs on the additive side of that
      line. Found by needing it: announcements are two new tables
- [x] **The backend suite cleans up after itself** — 560 dashboards, 151
      reports and 38 announcements had accumulated in the development
      database, one `database`-marked test run at a time. Every one was
      invisible in the suite's output and perfectly visible on the pages a
      reviewer opens. An autouse fixture now deletes what a test created and
      nothing older; a transaction rollback would be the textbook answer and
      cannot work here, because the app opens and commits its own sessions —
      which is the behaviour under test
- [x] **The audit export was silently truncating past ~1000 rows** — a 1042-row
      ledger wrote 1001 one run and 1008 the next, with a 200 on it: the
      truncated download `core/export` exists to prevent, arriving by a route
      nobody had thought of. `yield_per` holds a server-side cursor open across
      a response that is generated *after* the view returns; `partitions`
      materialises each chunk instead. Found because adding announcements
      pushed the table past the threshold
- [x] **Five e2e leaks and load flakes, none of them the product** — the
      suite is now green twice over at 162 tests
  - The e2e helpers asked Keycloak for a token in every `afterEach`; the realm
    is brute-force protected, so a few hundred direct grants started returning
    401 on whichever spec happened to be running. `signIn` now hands the
    browser's own token to the sweeps, which costs nothing
  - The board spec put its card back at the end of the happy path, so a failed
    run left it in the lane it had dragged it to. `NEW` lost one task per
    failed run until it held none — after which every run failed for want of a
    card to drag, taking another one with it. Restored unconditionally now,
    and the *seed* guarantees every declared status has a task, because an
    empty lane on a board is a column of nothing
  - The saved-search and announcement sweeps matched a title *prefix*, which
    under `fullyParallel` deleted a sibling test's fixture mid-test; both
    sweep exactly what they created. The saved-search sweep also has to use
    the *owning* persona, since only an owner may delete one (§5)
  - Five tests ended by driving the delete UI as cleanup and flaked on the
    panel's re-render; one asserts the delete flow, the rest use the sweep
  - The timeouts moved to 60s (test) and 45s (sign-in), because every failure
    they produced was a *timeout under load* — three workers against one API
    container and one Keycloak — and never a wrong value
- [x] **`/kanban` is implemented** (§18) — Jira-shaped: boards, lanes, epics,
      stories, tasks and bugs, with a card page, comments and drag
  - **Why it is a second board at all.** `/tasks` is a view of the work queue
    and its lanes are the declared `TASK_STATUS` vocabulary — the same values
    every filter, chart and report reads. A lane invented there would be a
    status nothing else has heard of, and a card in it would vanish from every
    report that counts by status. This is the other thing people mean by a
    board: columns they name, reorder and put limits on
  - **The hierarchy is one self-reference and one rule.** Three tables would
    be three sets of comments, three permission stories and three endpoints
    that all mean "a piece of work"; one table with a `kind` and a
    `parent_id`, and `PARENT_OF` stating once what may hold what — because
    that question is asked on create, on re-parent and on delete
  - **Order is dense integers, rewritten on a drop.** A float midpoint avoids
    touching neighbours and drifts into precision nobody can debug; this
    touches a handful of rows and can never leave two cards claiming one place
  - **A lane is deleted by moving its cards, never by cascading**, and the
    dialog says how many move and where. Losing somebody's work to a column
    they were tidying up is the single worst thing a board can do
  - **A WIP limit warns and never refuses.** A limit set last month must not
    stop an urgent card today — a board that argues gets worked around in a
    spreadsheet, and then nobody can see the work at all. The seed guarantees
    one lane is over its limit, because the warning is the point of the number
  - **Drag *and* a keyboard menu, through one mutation.** Drag-and-drop is the
    least accessible interaction there is; the two paths share a call so the
    one nobody uses by hand cannot break unnoticed (§64)
  - The card drawer writes on change, offers as a parent only what the rule
    permits, and carries the *same* comment thread and audit timeline every
    record page has — which needed `services/comments` to stop assuming a
    commentable thing is an explorer resource (a card is not a business
    record with a field catalogue; the board decides who may read it)
  - 22 backend tests, 17 component tests, 12 Playwright
  - **Two defects the tests found.** A board key was freed when a board was
    deleted, so the next board with that name numbered from 1 and its first
    card collided with the deleted board's `PLAT-00001` — a 500 on the first
    card of a new board. And the in-place "add a card" field read React state
    rather than its own value, so a reader who typed and hit Enter in the same
    tick submitted nothing at all
- [x] **The window is filled, on every page that had a void in it** (§20) —
      "no big empty spaces, full-width components" applied as a rule rather
      than page by page
  - **`.nu-pane` was not filling its region**, which is the defect behind most
      of them: `height: 100%` inside a flex container whose own height came
      from `flex: 1` resolves against an *indefinite* size and silently falls
      back to `auto` — so a table's card stopped at its last row inside a
      region 732 pixels tall. `flex: 1 1 auto; min-height: 0` states it
      directly, and the percentage stays for the grid case
  - A notice is now prose beside a facts rail rather than prose above one:
      four stacked label/value pairs made the rail eight lines tall, the rail
      then set the card's height, and the space under the shorter column
      *was* the new empty space. One line each and the two columns balance
  - The kind strip's chips share the row (`nu-kindstrip--fill`), and the meta
      line on a notification and an activity row puts the kind at one end and
      the time at the other, instead of leaving the right half blank
  - **A class-name collision I introduced.** The announcement card reused
      `nu-notice-*`, which `/notifications` already owns — two pages quietly
      restyling each other. Renamed `nu-announce-*`; the lesson is that a
      page-scoped prefix is only scoped if it names the page
  - **A cell that clipped instead of ellipsising.** `Space` wraps each child
      in an inline-flex item that never shrinks, so a title with `ellipsis`
      measured itself against its own content, never engaged, and the longest
      notice was cut mid-word under the tag beside it
  - One more e2e race of the same family as the earlier six: the lane-removal
      test waited for a card that was *already* on screen, so it waited for
      nothing and read the lane list before the refetch arrived
- [x] **`/workflows` is implemented** (§49) — condition → action automation, on
      the same query tree the advanced search builds
  - **Nothing here asks a new kind of question or makes a new kind of change.**
      The condition is the react-awesome-query-builder tree §4 already
      produces, compiled by `core/rules.py`; the records it matches come
      through the same `explorer` declaration every list, chart and export
      reads; the actions write through the services a person writes through.
      What this adds is the *loop* between them — and the same e2e helpers now
      drive both editors, so the claim that they are one editor is asserted
      rather than asserted-in-a-comment
  - **The cooldown is held per record, not per rule.** This is the difference
      between the requirement and a thing that looks like it: a rule cooling
      down as a whole would send forty messages about forty breached tickets
      in one run and then go quiet about the forty-first, which is the
      opposite of what §49 asks for. So `alert_rule_fires` is keyed on the
      pair and upserted — state, not history, bounded by rules × records
      rather than growing with every run
  - **A dry run is the same code path with the actions switched off.** Not a
      second evaluator: a preview that walks different code can disagree with
      the thing it previews, which is the one thing a preview must not do. A
      rule is *created paused* and the wizard's last step rehearses it, because
      the first version of a condition is usually wrong
  - **An action that fails is recorded, never raised.** A savepoint each, so
      an unreachable webhook loses neither the notification beside it nor the
      cooldown — a run that half-happened and rolled back would fire the same
      actions again next pass
  - **The run is bounded twice**: `MAX_MATCHES` caps what an evaluation looks
      at (a rule matching a whole table needs narrowing, not patience), and
      `MAX_FIRES` caps what one run *acts on*, with the remainder reported as
      deferred rather than dropped — nothing recorded their cooldown, so the
      next run picks them up
  - **The email action writes into the platform's own mailbox, in OUTBOX.**
      There is no mail transport in the template and an SMTP call would let a
      rule report success for a message nobody receives; the folder is the
      whole claim the row makes, and `/mail` is where it shows
  - Actions are declared beside what executes them and the API publishes that
      list, so the editor renders from the same declaration the engine runs —
      a form cannot ask for a field nothing reads, or fail to ask for one the
      executor requires (§76)
  - `automations.manage` gates *reading* too, unlike announcements: a rule's
      condition quotes the fields and values of records its reader may have no
      other way to see. Editing stays with the author, because an automation
      reaches other people's inboxes — with `admin.access` as the exception,
      since somebody has to be able to stop a rule whose author has left
  - The page is a table filling the window, the rule opens in a drawer, and
      the loud column is *Firing* beside the state: a rule that has never
      fired and one that fired forty times yesterday need completely different
      attention. "Paused" is a switch in the row, never three clicks deep
  - 33 backend tests, 26 component tests, 11 Playwright
  - **The same defect the seeded reports had, found by the same means.** Every
      seeded rule was unrunnable: four compiled their condition against a
      hand-built `FieldSet` naming `priority` on datasets that do not declare
      it, three watched `"job"`, `"user"` and `"file"` — keys the explorer has
      never had — and all ten carried actions in a shape the engine does not
      read (`{"type": "NOTIFY", "audience": "OWNERS"}`, addressed at nobody).
      A monitoring rule like that reports quiet, which is indistinguishable
      from good news. The generator now derives everything from the
      declarations, `--check` names what is broken, and
      `python -m src.seed --sync-automations` repairs an existing database
      without a destructive reseed: a rule whose dataset is gone is *paused*,
      because there is nothing to repair it to and a monitor that cannot look
      must not claim to be live
  - **Three more defects the tests found.** `_recipient_config` read the
      recipient keys at the action's top level while everything else nested
      them under `recipients` — one shape, and that was the wrong half. The
      wizard's dataset select carried both a `for`/`id` label and an
      `aria-label`, so the field was reachable as "Dataset" and announced as
      "Which records". And `test_raising_a_task_puts_it_in_the_normal_queue`
      raises *real* tasks, fifty a run, and `Task` was not in the suite's
      cleanup registry: 293 of them had accumulated — the same class of leak
      the announcements work fixed, in the one table a reviewer opens first
  - **And two pieces of housekeeping the work turned up.** A latent flake in
      `records-write.spec.ts`: an AntD dropdown is rendered at the body root
      and outlives whatever opened it, so a menu left over from an earlier step
      sat above the Edit button while `toBeEnabled()` was perfectly happy —
      Playwright then retried for a full minute and reported "Edit was never
      clickable", which reads as a product bug and is not one. And four
      throwaway screenshot probes (`light.mjs`, `shot.mjs`, `shot2.mjs`,
      `shot3.mjs`) had reached the repository across as many tasks; removed,
      and the pattern is ignored now so it stops happening
- [x] **`/calendar` is implemented** (§19) — month, week, day and agenda over
      one window of time
  - **A window is the query, and recurrence expands on the server.** The
      browser asks for `from`/`to` and gets *occurrences*; expanding a series
      in the browser would be a second implementation of the recurrence rule,
      and the two would disagree about the last Friday of a month long before
      anybody noticed. The model already materialised `recurrence_until` for
      exactly this: a series that cannot reach the window is excluded by a
      range scan rather than expanded and thrown away
  - **An occurrence is derived and says so.** Its id is `<event id>:<start>` —
      stable enough to key a grid on and obviously not a primary key. Editing
      one edits the *series*, and both the drawer and the editor say so
      **before** anything is touched, because an editor that silently changed
      one occurrence, or silently changed all of them, loses an afternoon
      either way. A per-occurrence exception is a second table and a question
      nobody has asked yet
  - **"Who is coming" is a fact about a person, and only they may state it.**
      `respond()` writes the caller's own entry and refuses any other; an
      organiser who could accept on somebody's behalf turns an attendance list
      into a guess, which is worse than an empty one. Answering needs
      `calendar.view` and not `calendar.manage` — it is not editing a calendar
  - **A clash is computed, never stored, and it is named.** Two events
      overlapping is a fact about a *reader*: the same pair is a clash for the
      two people in both and irrelevant to everybody else. So it is worked out
      over the window that was asked for, for the person who asked, in one
      linear pass over the sorted list — and the answer is "clashes with the
      Design review" rather than "1 conflict", which is a hunt
  - **Unanswered invitations are the only count that is a to-do list**, so
      that is the one on the header, and it is a filter rather than a
      decoration. "17 events this month" is a fact nobody acts on
  - The date arithmetic is a module of its own (`lib/calendarGrid.ts`) with 15
      tests, because every mistake in it is invisible in a screenshot and
      obvious to whoever misses a meeting: a grid starting on the wrong
      weekday, a "next month" that skips February from the 31st, a day parsed
      as UTC midnight and shown a day early
  - The event vocabulary moved into `core/vocabulary.py` — categories,
      statuses, responses and the frequencies the expander understands — so the
      seed, the API and the editor all read one list. The editor's kinds now
      come from the server for the same reason
  - 40 backend tests (the expander tested as the pure function it is), 33
      component tests, 12 Playwright
  - **A defect the tests found, in a control rather than in the logic.** The
      answer control was a `Segmented` with `value={undefined}` for an
      unanswered invitation — and AntD's Segmented has no unselected state:
      given no value it highlights the *first* option. So every invitation
      nobody had answered rendered as **Going**, directly beside the sentence
      "You have not answered yet". A control that cannot say "no answer" is
      the wrong control for a question whose commonest answer is silence; it
      is three buttons now, shared by the agenda and the drawer
  - **And one layout defect fixed before it shipped.** The week view was seven
      full-height columns of chips, which left six hundred pixels of nothing
      below a fortnight's meetings — the exact "big empty space" the layout
      rules exist to remove (§20). It is an hour band now, derived from the
      events so a 07:03 standup is not hidden by a grid that starts at 08:00
      and a quiet week is not one row tall. Placed by CSS grid and never by
      pixels: no measurement, nothing to break under a font change
- [x] **`/mail` is implemented** (§14–§16) — a threaded mailbox, a reading
      pane and a composer
  - **A mailbox belongs to exactly one person, and that is the whole access
      model.** Every query is scoped to `owner_id == me`: no sharing scope, no
      polymorphic share table, no "public" mailbox — because a mailbox is not
      that kind of object, and the moment one exists every endpoint needs a
      second rule about whose mail this is. Somebody else's thread answers
      **404 and not 403**, because saying "that exists but is not yours" is
      itself the disclosure
  - **The thread's summary is recomputed, never adjusted.** `message_count`,
      `unread_count`, `snippet` and `participants` are denormalised so an
      inbox list draws without joining messages — but a *decremented* counter
      drifts the first time two things happen at once, and a wrong unread
      badge is the single most irritating bug a mail client has. One function
      recomputes all four from the rows, and nothing else touches those
      columns
  - **Sending puts a message in OUTBOX, not SENT.** There is no mail transport
      here; writing `SENT` would have the mailbox claim a delivery it cannot
      make, and a demo that lies about the one thing a mail client is for is
      worse than one that says "queued". The composer says so on the way in
      and the folder rail's tooltip says why the folder exists
  - **A draft is a message, in the same table.** `is_draft` and a null
      `sent_at`, so a draft is searchable, carries attachments, and becomes a
      sent message by being sent — rather than copied between tables leaving
      two ids behind. Editable until it goes and never afterwards: a queued
      message is a record of something that happened
  - **The bin takes two presses**, because a single irreversible delete is the
      gesture people most often regret — and a bin a second press empties
      needs no confirmation dialog to be safe
  - Bulk actions are one endpoint rather than a loop of `PUT`s in the browser:
      fifty round trips for one gesture, each able to fail on its own, leaves
      the list in a state nobody chose. The bar arrives when something is
      selected, with the count on it
  - Labels are counted **within the current folder**, because that is the
      folder the filter searches. A mailbox-wide count beside a folder-scoped
      filter promises rows the click cannot find, which is worse than no count
  - A template fills what the composer left blank and never overwrites what
      was typed, and the *server* does the filling — `{{ name }}` and
      `{{name}}` are the same placeholder, and a second implementation in the
      browser would disagree the first time somebody wrote a space
  - 36 backend tests, 28 component tests, 13 Playwright
  - **The demo mailbox was nearly empty, and the seed's own docstring promised
      otherwise.** `_mailbox` says "the personas own most of the mail — an
      inbox is only worth looking at from an account that has one", and at the
      small scale ten threads over five personas and five folders left the
      *administrator* — the account everybody signs in as first — with two
      threads, neither in the inbox. `_cover_every_persona_inbox` now
      guarantees six, and `python -m src.seed --sync-mailboxes` tops up an
      existing database the way `--sync-reports` and `--sync-automations` do.
      That repair had a bug of its own worth recording: seeded from a
      *constant*, it regenerated the same UUIDs, so a second run that found
      one persona short collided with the rows the first had written for
      another — idempotence by counting is not enough when the number
      generated varies
  - **Four more defects the tests found.** `_recount` read the relationship
      SQLAlchemy had already loaded, so a reply counted as no reply at all.
      `PUT {"send": true}` on a complete draft was refused, because the
      recipient check read the *payload* rather than the row it had just
      written. Collapsing the folder rail to icons below 1280px hid the only
      accessible name every folder button had — 71 axe violations from one
      `display: none`. And the page could mark threads read but never unread,
      though the service supported it: "I have read this and want to come back
      to it" is half of what the flag is for
  - **And two the *suite* found in itself.** The first version of
      `test_mail.py` read the seeded mailbox, and its own earlier tests
      archived the threads its later ones went looking for — draining the
      administrator's inbox permanently, because the autouse cleanup removes
      rows a test *created* and cannot un-archive rows it *edited*. Every test
      makes its own mail now. And the composer's `validateFields()` rejects on
      an empty field, which `void submit(true)` swallowed: 445 tests passing
      and one unhandled rejection in the run
- [x] **`/home` is the default landing page** (§40) — what is waiting for
      *this reader*, rather than the organisation's numbers
  - **It is not the dashboard, and that is the whole point.** `/dashboard`
      answers "how is the business doing"; this answers "what is waiting for
      me". A landing page that opened on revenue is one somebody scrolls past
      every morning to find the three things they have to do
  - **It adds no endpoint.** Every number comes from the endpoint its own page
      uses — notices, notification counts, the calendar's window, the
      mailbox's list, the same explorer query the task board runs. A
      `/api/home/summary` would be a second place each of those is computed,
      and the first time two disagreed nobody would know which was right
  - **Only actionable things are counted, and a count of nought is not drawn
      at all.** "1,284 tasks exist" is a fact nobody acts on; a row of zeroes
      teaches a reader to ignore the strip, and then the one that is not zero
      is invisible too. When everything is clear it says so in a sentence
  - **A card for a feature the reader cannot use is absent, not empty** (§76),
      and the gate is asserted in both directions
  - `landing_page` now defaults to `home` on the server, and `landingPath`
      falls back to it: somebody who has expressed no preference is somebody
      arriving for the first time, and the dashboard is one click away
  - 10 component tests, 11 Playwright
- [x] **A pass over every page for hardcoded data and missing CRUD**, asked for
      directly. What it found:
  - **Four vocabularies were typed into the browser** that the server already
      owned: the kanban card drawer's priorities, the automation editor's task
      priority, the mail composer's priority, and the notification centre's
      categories *and* severities. Each now comes from the payload that
      already carried it, or from a payload that now does
  - **And one of those was wrong.** The notification categories were written
      out in three places — `services/notifications`, the seed's catalogue and
      a frontend constant — and `ALERT` had been added to none of them. So
      every notification an automation sent (§49) was **unfilterable**:
      present in the list, absent from the only control that narrows it. Both
      lists moved into `core/vocabulary`, and the seed's icon map now asserts
      it covers the vocabulary rather than raising a `KeyError` mid-run, which
      is how this was found
  - **Every avatar in the platform was a serious accessibility violation.**
      AntD renders an `<img>` when `src` is set, the seed gives every user an
      avatar data URI, and none of them had alternative text — the shell, the
      people picker, every comment thread, the user list and the user page.
      One `PersonAvatar` now decides it once: empty alt and `aria-hidden`,
      because an avatar here always sits beside the name it would otherwise
      make a screen reader read twice
  - **Roles had no create and no delete.** `is_system` had been on the model
      from the beginning and every screen rendered it, but there was no way to
      make a role that was not one: an administrator could edit the five the
      seed writes and nothing else. For an application *template*, "these are
      the only five roles you may ever have" is the wrong answer. A custom role
      can now be created (never as a system role, whatever the payload says)
      and deleted — refused while anybody holds it, with the number named,
      because a cascade would silently leave people with no permissions at all
  - **Users deliberately have no delete**, and that is the CRUD being
      complete rather than short: the write path sets `status`
      (ACTIVE/INVITED/SUSPENDED/DISABLED), and hard-deleting somebody who
      organised meetings, wrote comments and owns a mailbox would either
      cascade through half the database or orphan it
  - The read-only modules — activity, audit, health, maps, meta, search, the
      relationship and analysis endpoints — are read-only because they are
      *views*, and a POST to any of them would be a second way to write
      something that already has one
- [x] **The administration area's index, `/admin/settings` and `/admin/flags`**
      (§11, §27) — runtime configuration, and who has what
  - **`/admin` is a map, not a second dashboard.** The area is eleven screens
      people visit rarely and need to *find*; what the index owes them is where
      each one is and what it is for. A second set of KPIs here would compete
      with `/dashboard` and answer nothing an administrator came for. Each card
      carries one live number, and only where one is cheap — how many people,
      how many settings differ, how many flags are on — taken from the endpoint
      that card's own destination uses, so the number cannot disagree with the
      page it sends somebody to
  - **A card the reader may not open is absent, not greyed out** (§76), and the
      index is rendered from the same permission string each destination
      checks, so the two cannot drift. The e2e asserts the gate from the other
      side too: a manager holds `users.manage` and `jobs.view` and *not*
      `admin.access`, which `core/auth` documents as the single gate for the
      whole area — so the route is closed and not merely unlinked
  - **Every settings control is rendered from the setting's own declaration.**
      A boolean gets a switch, a choice a select, a bounded number a bounded
      number. Adding a setting on the server needs no change in the browser —
      and a page that ignored the declaration would render a boolean as a text
      box and store the string `"false"`, which reads as *true* everywhere it
      is used. `controlFor` is the whole mapping, exported and asserted
      directly, because driving seven forms to check it would be seven tests
      about AntD
  - **The value is coerced on the server**, against the type the setting
      declares and the `minimum`/`maximum`/`choices` it was seeded with. The
      e2e writes 45, reloads, and reads it back from the database rather than
      from the box that sent it: a browser sends `"45"` and the column has to
      hold `45`
  - **A secret is shown as *set*, never shown.** `_visible` cannot return one,
      the payload carries `••••••••` for the value *and* the default, and the
      field asks for a replacement rather than offering what is there. The e2e
      records every response body on the page and asserts the seeded
      `whsec_…` appears in none of them — a settings page that renders a
      signing key has put it in a screenshot, a browser cache and a support
      ticket
  - **Drift is on the face of it.** Each changed setting says what the platform
      ships with, with Reset beside it — and only where there is something to
      undo, because a column of permanently disabled buttons is noise. "Somebody
      chose this" and "this is how it comes" are different facts
  - **A flag's rollout is one function, and it is the same answer every time.**
      `is_on` buckets on `sha256(f"{key}:{user_id}")`, so a reader either has a
      flag or does not, on every request and after every deploy — a flag that
      flickered would make every bug report about it unreproducible. The table
      says so in words (`reachOf`): "50% of people, always the same ones", and
      "Nobody — no rollout and nobody named" for the state that looks like a
      bug and is a configuration
  - **A flag arrives off, and says so on the way in.** Whatever the payload
      claims: a flag created enabled would ship whatever it guards at the
      moment it was made. Delete is refused while it is on — disabled with the
      reason rather than absent, because deleting a spent flag *is* something
      an administrator does (§76)
  - **Two accessibility defects, and the palette test that should have caught
      one.** `contrast.test.ts` exists so a low-contrast token fails in
      milliseconds rather than being found one page at a time by axe — but it
      checked the semantic inks against the page and a card, and not against
      the ground a preset `Tag` is actually drawn on. AntD *derives* that tint
      from our seed rather than taking it from its stock palette, and our
      greens are saturated enough that the ramp desaturates them to `#d3e3d6`
      and `#daf1f2` instead of the near-white `#f6ffed` and `#e6f4ff`: the
      success ink scored 3.76:1 there and failed, and the info ink passed by
      0.05. Both moved a step darker, and the test now derives each tint
      through the same algorithm the theme uses — so the next change to
      `SEMANTIC` fails a unit test instead of a browser
  - The other was the rollout slider: AntD forwards `aria-label` to the
      wrapper, and the element carrying `role="slider"` is the *handle*. Nine
      unnamed inputs on one screen, each announced as "50, slider" with no clue
      which flag it moved. `ariaLabelForHandle` is the prop that reaches it
  - **Additively repairable, like every other seeded thing** — `--sync-settings`
      adds settings the catalogue declares and the database lacks and fixes any
      whose stored value no longer fits its declaration, without a reseed

- [~] **One activity-feed flake fixed, and three left tracked rather than
      guessed at.** `activity.spec.ts` asserted that clicking a kind chip
      leaves the counts *equal*, which is false on a live stack: every sign-in
      writes a SECURITY row, the suite signs in on every test, and
      `fullyParallel` runs three workers — so a sibling authenticating between
      the two reads failed it. The claim is now "the other kinds are still
      positive", because nought is the only value the defect it guards against
      could produce
  - Three others failed once each in one parallel sweep and passed both alone
      and in the next full run, so they were recorded rather than "fixed" on a
      hypothesis: `dashboards.spec.ts` "one person has one home dashboard",
      `entities.spec.ts` "a reader without export rights is told", and
      `maps.spec.ts` "clicking a country opens the records that are there".
  - **And the maps one turned out to have nothing to do with parallelism.**
      Kept whole under `--reporter=list`, the error was a URL assertion
      failing fifteen seconds after a click that had done nothing:
      `locator("tbody tr").first()` had matched AntD's *empty state*, which it
      renders as a `<tr class="ant-table-placeholder">`. That row is visible,
      so `toBeVisible()` passes on it; its first cell reads "No data", which
      became the country name; and clicking it does nothing at all. It only
      appears while the table is still loading — hence green alone and red in
      a loaded sweep. Every `tbody tr` in the suite now asks for
      `tbody tr[data-row-key]`, which is the same guess the hypothesis above
      would never have found: the cause was a locator, not shared state
  - **And one more correction, this one to the diagnosis rather than the
      code.** Two later sweeps produced four failures each, all at almost
      exactly the fifteen-second `expect` timeout and all in *different*
      specs — which reads as a systemic stall. The log this task had just
      built is what settled it: no HTTP request in the window exceeded 900ms,
      and a 60-way concurrency burst answered in 0.28s at 250ms worst. The
      cause was outside the product entirely — a `make test-backend-db` run
      against the same PostgreSQL *while the sweep was running*, twice, which
      starved three browsers and the API. Recorded because it is the mistake
      to avoid repeating: a suite measured while something else is hammering
      its dependencies produces failures indistinguishable from real ones,
      and two rounds were spent chasing them
- [x] **`/admin/logs` — and the log it reads is the platform's own** (§22)
  - **The table was fiction, and that was the defect.** The seed writes two
      hundred plausible lines whose correlation ids match nothing, so the one
      thing a log console exists for — somebody pastes the id off an error
      screen and finds the request — could not be done at all. Every response
      already carried `X-Correlation-ID`, every failure payload already
      repeated it and the frontend already printed it on its error screens;
      the half that was missing was anything writing it down
  - **`core/logsink.py` closes that loop**: one `system_logs` row per API
      request, with the method, the path, the outcome, the duration, the
      person and the route. `retention.log_days` had been a seeded setting
      since the first pass, waiting for rows to bound
  - **It is the deliberate opposite of the audit rule.** `core/audit` takes the
      caller's session so a rolled-back update cannot leave an entry claiming
      it happened; the log sink opens its *own*, because the rolled-back
      request is precisely the one worth a line and sharing the transaction
      would delete the evidence with the cause. An audit row is part of the
      change; a log line is a report about it
  - **And it cannot fail a request.** Guarded at the writer *and* at the
      `teardown_request` boundary — not redundantly: an exception in a
      teardown hook propagates out of `ctx.pop` and fails a response that had
      already succeeded, which is a defect the test found by monkeypatching
      the writer to raise. Trusting the callee to be safe leaves the whole
      application one refactor away from an outage
  - **Health probes and the log endpoints are excluded.** The container asks
      for health every few seconds and would bury everything else, and a
      viewer that wrote a line about each of its own reads is a table that
      grows while somebody looks at it and a tail that never goes quiet
  - **The level is derived from the outcome**, never chosen by the caller: a
      caller-chosen level makes the column a matter of taste and the filter
      beside it useless. `>=500` is ERROR, `>=400` is WARNING, a *slow*
      success is WARNING too — so "show me the errors" is a question with one
      answer
  - **The level strip is a severity floor, not a set of toggles.** Clicking
      WARNING means warnings *and worse*, because somebody clicking it is
      looking for trouble and an ERROR hidden behind the filter chosen to find
      it is the worst thing a log viewer can do. `LOG_LEVEL` moved into
      `core/vocabulary` ordered quietest-first and the server slices it, so a
      level added there is ranked by where it is put — the page never knows
      the ranking. Asserted arithmetically end to end: under the WARNING floor
      the total equals the warning, error and critical chip counts added up.
      The chip says "and worse" out loud, because a filter that quietly did
      more than its label is one nobody trusts
  - **The tail is a poll with a cursor, not a socket.** Pausing is simply not
      asking and resuming asks from the id it stopped at, so nothing repeats
      and nothing is missed. A socket would need a broadcast from every worker
      for every request — a log stream costing more than the requests it
      describes — and a viewer that reconnected across a deploy would show a
      gap it could not explain. The cursor is a line id rather than a
      timestamp because two lines can share a millisecond, and a timestamp
      cursor either repeats them or drops one; the ordering is
      `(logged_at, id)`, and there is a test that writes four lines at one
      instant and walks the tail past them
  - **A cursor whose line is gone is refused, not restarted.** A tail that
      silently jumped back to the beginning would replay an hour of lines into
      somebody's viewer
  - **One line opens onto its whole request**: the context, the stack trace,
      and the siblings sharing its correlation id — one failure is rarely one
      line, and reading "permission denied" without the request that caused it
      is reading half the story. Neither heavy field is in the list, because a
      list carrying every stack trace is a page weighing megabytes for the
      sake of the one row somebody expands; the rows carry `has_context` and
      `has_stack_trace` so the table can still mark what is worth opening
  - **Pruning takes its bound from the setting, and needs the setting's
      permission.** No `days` parameter — that would make it an arbitrary
      delete endpoint wearing a retention policy's name, and there is a test
      that passes `?days=1` and asserts the declared bound was used instead. A
      manager may read the log and may not enact the policy on it, which is
      the same split as anywhere else the bound and the data have different
      owners
  - **A third accessibility lesson, and a new kind.** `opacity: 0.55` on the
      "and worse" hint took secondary text to 2.97:1. Opacity *multiplies*
      whatever colour it lands on, so it escapes the palette entirely —
      `theme/contrast.test.ts` cannot see it and no token choice protects
      against it. Set apart by size now. The other five opacity rules in the
      stylesheet were checked and are graphics or disabled controls, which
      WCAG exempts
  - **`JOB_KIND`, `JOB_STATUS` and `LOG_LEVEL` moved into `core/vocabulary`**
      with the seed's weights derived positionally, which is the same repair
      the notification categories needed — a value added to a list in one
      place and not the other is the bug that made every automation
      notification unfilterable
  - **The suite's own teardown had to grow a column.** A row per request means
      every database test leaves a line behind, so `SystemLog` joins the
      cleanup registry — and its timestamp is `logged_at`, not `created_at`,
      because a log line's one timestamp is the moment it describes and a
      second column recording the *insert* would be the same value twice. The
      column is derived per model now and asserted, rather than assumed: a
      `DELETE` naming a column that is not there fails the teardown of every
      test in the suite at once

- [x] **`/admin/jobs` — the queue, and the two verbs that act on it** (§23)
  - **Retry and cancel are gated on the *state*, not on the permission alone.**
      A running job cannot be retried, because retrying it would put two runs
      on the same rows — the commonest way a queue console corrupts what it was
      built to supervise. `JOB_TERMINAL` and `JOB_CANCELLABLE` in
      `core/vocabulary` are the two sets that decide it, and a test asserts
      they partition `JOB_STATUS` exactly: a status in neither would be a row
      the console can only stare at, and one in both would offer two
      contradictory actions at once
  - **`max_attempts` is a real bound, and the refusal's advice is now real
      too.** Refused with the number named, because a three-attempt limit that
      allows a fourth is worse than no limit — somebody is relying on it. But
      the message said "raise the limit if it should be tried again" when the
      product offered no way to raise it, which is the worst kind of error
      message: one naming a fix that does not exist. `allow_attempts` is that
      fix — its own verb rather than a flag on retry, because raising a limit
      and running the work are two decisions; upward only, since "attempt 4 of
      3" is a state the console would have to explain; and capped at
      `MAX_ALLOWED_ATTEMPTS`, because "retry until it works" is how a broken
      job writes the same rows forty times. The control appears on exactly the
      rows where it would change something, which is exactly where the retry
      refusal points at it
  - **A retry is the same row, not a new job.** `attempt` goes up, the outcome
      is cleared, the previous attempt's log lines are *kept* — they are the
      evidence of why the retry exists. A fresh row per retry would lose the
      connection between them and count one failure as three, and the e2e
      asserts there is exactly one row for the reference afterwards
  - **A cancel is not a delete.** The row stays, CANCELLED, with who stopped
      it and when: a queue whose cancelled jobs vanish cannot answer "why did
      the nightly export not run last Tuesday", which is the question it gets
      asked
  - **`can_retry`/`can_cancel` ride on every row**, so a button the page draws
      is a button the endpoint honours. The rules are stateful and a browser
      re-deriving them would eventually disagree with the server — the MSW
      fixture computes them from the same two rules for the same reason
  - **A refusal is a disabled control with *which* refusal it is** (§76).
      `whyNot` is exported and asserted directly: "it is running and has not
      finished — retrying now would run it twice over the same records" and
      "all 3 attempts have been used" are different problems with different
      fixes, and a shared "not allowed" would have told an operator neither.
      Contrast the settings index, where a card is *absent*: there the reason
      is a permission, which will not change while somebody looks at it — so
      the read-only case here says so once at the top instead of drawing a
      column of dead buttons
  - **Progress is a number and a bar, in that order.** The bar is
      `aria-hidden` decoration; "40 of 100, 60 failed" is the part that can be
      read out and compared between rows (§64). And *not* AntD's
      `status="active"` for a running job: that bar animates forever, so the
      page never goes idle — it costs a laptop battery on a screen somebody
      leaves open, and it made every wait-for-animations assertion in the spec
      time out. The shimmer carried nothing the status tag was not already
      saying
  - **RETRYING was seeded wrong, and the page is what exposed it.** The
      generator gave it the running branch: no error message and attempt 1 —
      so a queue could say a job was retrying and never say why, which is the
      one distinction an operator reads this screen for. It carries the failure
      that caused the retry now, on attempt 2 of 3
  - **The guarantee is a minimum, because the suite spends it.** RETRYING is
      weighted at 0.04 and came out empty at the small scale, so
      `GUARANTEED_PER_STATUS` tops every status up — and it is 3 rather than 1
      because the e2e retries a job and cancels another, and a retry spends an
      attempt irreversibly. One per status made the spec a ratchet that drained
      a state per run, which is exactly what happened to the `NEW` task lane.
      `--sync-jobs` tops it back up additively, the same shape as
      `--sync-mailboxes` and `GUARANTEED_INBOX`
  - **And the spec restores what it can**: it retries a *cancelled* job and
      cancels it back, and cancels a *queued* one and retries it back, so the
      status distribution it finds is the one it leaves. Its targets are chosen
      through the API rather than by row position, because a queued job that
      has used its attempts can be cancelled and not retried — and the table
      does not show an attempt count of 1, so the row alone cannot say which is
      which
  - **What it cannot restore is an attempt**, and that is the product being
      right rather than the test being weak: `attempt` is a record of what
      happened and no endpoint rewrites it. Granting the attempt back was tried
      and only traded the drift for `max_attempts` climbing towards its
      ceiling — so the contract is the one `--sync-mailboxes` already sets for
      the mailbox drain. `sync_jobs` guarantees at least one *retryable* job
      per status, which is the guarantee that actually ran dry: topping up by
      row count alone kept finding five cancelled jobs and never noticed every
      one had spent its attempts. The spec's guard names the repair, and the
      jobs it adds are `fresh=True` so the repair is deterministic in its
      effect — the ordinary draw gives attempt 3 seven times in a hundred, and
      a repair that worked ninety-three per cent of the time is one nobody
      trusts
  - **No create, deliberately.** Nothing in the platform enqueues a job yet;
      `limits.max_export_rows` is declared and unread. A "New job" button would
      write a row no worker reads, and the enqueue path belongs with `/exports`
      (§30) where the setting already promises it
  - Two more test-vs-library differences worth recording: Playwright matches an
      accessible name as a *substring* where testing-library's `name` is exact,
      so `{ name: "Retry" }` also found every "Retry JOB-000011" button and the
      "retrying" chip; and a `Tooltip` nested inside a `Popconfirm` renders a
      second popover *over* the first, so the hint ended up intercepting clicks
      on the button it described. The tooltip now lives only on the disabled
      path, which is the only place it carries information

- [x] **`/admin/groups` — sets of people, and what being in one adds** (§11)
  - **The page has two privilege levels, because two of its fields do.**
      `core/auth._permissions_for` unions a group's permissions onto its
      members' roles, so whoever may edit them may grant any permission to
      anybody — themselves included. Editing *membership* therefore needs
      `users.manage`; editing what a group *grants* needs `roles.manage`, the
      same permission that governs the role matrix. Without that split
      `users.manage` would quietly be worth every permission in the catalogue:
      a manager holds it, does not hold `roles.manage`, and could otherwise add
      `roles.manage` to a group containing themselves and have it on their next
      request
  - **Asserted from both sides, in three places.** The service refuses the
      grants endpoint to a manager *and* refuses `permissions` on the plain
      update endpoint rather than silently dropping it — silently dropping a
      field somebody submitted is how a UI comes to believe it saved
      something. The component test checks the page offers one panel and not
      the other, and the e2e checks the *server* refuses both routes, because
      a gate enforced only in the browser is not a gate
  - **And the whole point, which only a real stack can show**: a viewer who
      cannot open the audit ledger is put in a group granting `audit.view` and
      can read it *on the next request* — no re-login, no cache to bust — and
      loses it again when taken out. The direction a security review asks
      about is the second half
  - **A retired group stops granting.** Soft-delete is a flag and
      `_permissions_for` walks the relationship, so `remove` empties the
      membership as well as setting the flag — otherwise a group nothing lists
      any more would go on granting everything it granted, invisibly. There is
      a test that grants, joins, deletes, and checks the access is gone
  - **A grant is checked against the permission catalogue**, with the
      near-misses named: a group granting `records.expport` grants nothing at
      all and looks in every screen exactly like one that works, which is the
      quietest possible way to believe somebody has access they do not. The
      editor renders its options from the same catalogue, so it cannot offer
      one no endpoint requires
  - **A new group grants nothing, whatever the payload says.** Otherwise
      creating one would need two privileges, and the create form would be one
      level or two depending on what somebody typed into it. Said on the way
      in, too, because a group that arrived granting something would grant it
      at the moment it was made
  - **Membership is set as a whole list, not a delta**, so the request says
      what the group *is* and two administrators editing at once cannot
      interleave into a state neither chose
  - **What a group grants is named on the row, not counted.** "3 permissions"
      does not answer whether being in this group lets somebody export the
      customer list; the names do, and the count is only the overflow. Same
      reasoning for the removal confirmation, which names how many people are
      in it and which permissions they lose — the whole hazard of this screen
      is quietly reducing somebody's access
  - **Deleting is allowed while occupied**, unlike a role: a role is somebody's
      identity and there is exactly one, a group is a set and the model is
      soft-delete, so refusing would only mean emptying a group of forty by
      hand first
  - **The slug is derived and follows a rename**, because a URL and an
      integration hold on to it — and a rename that would collide is refused
      rather than silently breaking whatever holds the old one
  - `GROUP_KIND` joins `core/vocabulary`, and `seed/catalog` now asserts its
      groups against it *and* against the permission catalogue at import: the
      kinds were literals in seed rows, and a kind spelled only there is one
      the page's filter has never heard of. Member `initials` come from
      `core/naming` rather than the browser, since that helper exists precisely
      because the rule was once written twice and the two copies disagreed
      about middle names
  - Two more AntD lessons, both already learned once in this session and both
      re-learned here: `getByLabelText` finds two elements because the
      accessible name lands on the wrapper *and* the inner input
      (`getByRole("combobox")` is the fix), and an option must be *filtered to*
      before it can be clicked, because rc-virtual-list renders only the
      visible window and the real catalogue is forty-odd permissions long

- [x] **`/admin/organizations` — the shape of the company** (§42)
  - **`departments.headcount` was fiction, and the page is what found it.** The
      column was drawn at random *before* the users existed, so Support stored
      116 people with nobody at all assigned to it — while `users.department_id`
      said 0. Two numbers for one fact, no reader anywhere, and the stored one
      lying. The service counts the assignment so the API is right even if the
      column drifts again; the seed now fills it from the people once they
      exist; `--check` reports any department that disagrees; and `--sync-org`
      recounts. It is the only repair that *edits* rather than inserts, which
      is safe exactly because what it edits is derived
  - **A department's own people and its subtree's are two numbers, labelled.**
      One alone is a lie in one direction or the other: its own understates a
      parent, the rollup makes a tree sum to more than the company employs. And
      the wording is "2 here, 7 in all" rather than "7 below", because
      `people_in_subtree` *includes* the department — the first version read as
      nine people when there were seven. There is no collapse-when-equal case
      either: a parent whose children are all empty would then have said "5
      below" when all five were *here*
  - **The tree's arithmetic is asserted end to end**: every rollup equals its
      own plus its children's, and the roots plus the *unplaced* equal the
      tenant's total. Which is why people in no department are counted on the
      screen — that number is the only thing explaining a tree summing to less
      than the tenant holds, and without it somebody spends an afternoon
      looking for the missing forty (§34)
  - **A department cannot become its own ancestor**, and the refusal names the
      path that would close the loop rather than saying "invalid parent" — on a
      four-level tree that message starts an investigation instead of ending
      one. `_ancestry` and `_depth_of` are both bounded, because the code that
      *detects* cycles must not be the code that hangs on them; there is a test
      that forces a cycle past the API and checks both terminate. The page
      prunes the offending subtree from its picker as well, since a control
      that produces an error on purpose is not a control
  - **Retiring is refused while anything is inside**, unlike a group: a group
      is a set and can be dissolved, a department is a *place* whose foreign
      keys cascade — a silent delete would take its teams with it and leave its
      people pointing at nothing. The refusal counts the people, the teams and
      the sub-departments in the way
  - **Following the route's permission through found an over-exposure.** The
      navigation gates the *route*, not just the menu, and it declared
      `orgs.manage` — which made the page's own read-only branch unreachable.
      Opening it at `users.view` is right, because where somebody sits is
      directory information — but that permission is held by every role, and
      the payload carried `annual_revenue`. So the commercial field is now
      withheld unless the reader holds `orgs.manage`, *omitted* rather than
      zeroed so the page can tell "not shown to you" from "nothing", and the
      admin index card's permission moved to match the route it opens
  - **`ORG_TIER` and `ORG_STATUS` join `core/vocabulary`**, the tiers ordered
      smallest-first so a page can render them as a scale. `ORG_STATUS` is its
      own tuple rather than reusing `CUSTOMER_STATUS`: the three words are the
      same today, and an organisation is the *installation's* tenant while a
      customer is a record inside it — sharing the tuple would tie two
      unrelated lifecycles together the first time either grew a state
  - **Hover-revealed row controls were the wrong idea and are gone.**
      `opacity: 0` leaves every button in the tab order and in the
      accessibility tree while invisible, and it needed a `@media (hover:
      none)` escape hatch for touch on top. Small icon buttons, always
      visible, like every other admin table
  - **And the Tooltip-inside-Popconfirm bug was made twice.** It renders a
      second popover over the confirmation and intercepts the click; the jobs
      table hit it, and this page reintroduced it two hours later. Both now
      carry a comment saying why the hint is absent on the enabled path — the
      button's accessible name and the dialog's title already say the word
  - Also: the department code is upper-cased rather than refused for being
      lower, since `eng` and `ENG` are the same code to everybody except a
      string comparison; and `no-base-to-string` was caught a third time in
      `test/handlers.ts`, so the fixtures now have one `text(value)` helper
      instead of ninety-nine hand-written `String(...)` calls waiting to be
      the fourth

- [x] **`/admin/api` — the machines that call this platform** (§25)
  - **A secret is shown once, and that is a *property* rather than a policy.**
      Only `secret_hash` is stored, so there is nothing to show a second time —
      which changes what is worth testing: not "the second request is refused"
      but that the plaintext is in no row and no later response. The e2e mints
      one, then asks every endpoint that returns that credential in turn and
      greps the database for it
  - **The page is built around losing it being hard.** A modal, not a toast: a
      notification that scrolls away takes the key with it, and the recovery is
      minting another and redeploying whatever held the old one. It cannot be
      dismissed by clicking the mask, and confirming asks again with a way
      back
  - **A client cannot be scoped beyond what its creator holds.** Scopes come
      from the permission catalogue, so granting one to a machine is granting a
      permission — a client scoped `users.impersonate` is a machine that can
      become anybody. Without the ceiling `api.manage` would be worth
      everything in the catalogue, the same escalation `/admin/groups` had to
      close. Only ADMINISTRATOR holds `api.manage` today; the rule is there so
      that stays true if a narrower role ever gets it, and it is asserted with
      a synthetic caller holding `api.manage` and little else. The *form*
      offers only the caller's own scopes and counts what it withheld, since a
      form offering the whole catalogue and refusing half on save is a form
      that produces an error on purpose
  - **Rotation issues a new credential and gives the old one a deadline.** A
      rotation that killed the previous secret the instant a new one was minted
      is not a rotation, it is an outage with extra steps — every caller
      holding the old key fails until somebody redeploys them. Seven days is
      long enough for a deploy and short enough to be a deadline, and it never
      *extends* a key that already expires sooner. `rotated_from` records the
      chain, which is what makes "how old is the key this service uses" a
      question with an answer
  - **A revoked credential is kept**, because the question after a leak is
      always when and by whom and a row that vanished answers neither. Revoking
      twice is refused: "revoke" succeeding twice suggests the first did not
      take. And retiring a client revokes every live key it holds — a
      soft-deleted client whose credentials stayed live would be a consumer
      nothing lists any more, still able to call, which is exactly the shape of
      bug a retired *group* had
  - **A credential's state is derived from its dates, not read from its
      column.** A key whose `expires_at` passed last Tuesday is expired
      whatever `status` says, and revoked beats expired: a key revoked before
      it ran out was revoked
  - **`requests_total` was checked against the request log before assuming a
      defect.** Three point seven million lifetime against twelve logged rows
      looks like the `headcount` problem and is not: the counter is a lifetime
      figure and the log is a recent window the gateway keeps. So the fix was
      *labelling* rather than recomputing — "Requests (lifetime)" beside "In
      the log below", because a screen that put them together unlabelled would
      read as one answer that happens to be wrong (§71)
  - **A date is not an answer**, so `credentialStory` says "Expires in 7 days"
      and "Expires today — redeploy now" rather than printing a date the reader
      has to subtract from today. EXPIRED gets a warning tone and REVOKED none:
      expiry is usually a rotation nobody finished, revocation is a decision
      somebody made, and colouring the second red would put every deliberate
      act on the same footing as a fault (§64)
  - **Two defects the tests found.** After minting a key the page was supposed
      to open the client it had just made, and did not: `set({ client: id })`
      ran *after* an `await`, and the navigation was lost — so somebody who had
      just minted a secret landed back on the list. And the spec's own cleanup
      matched clients by name prefix with `find()`, which swept an *earlier*
      run's row and left the new one behind three times over; it takes the id
      out of the address now
  - Also: an AntD `Modal` forwards unknown props to a wrapper that exists at
      zero size even when open, so `data-testid` on the component is never
      "visible" — it belongs on the content

- [x] **`/admin/integrations` — what this platform talks to** (§26)
  - **"Not configured" was a lie on every row it appeared on.** The seed drew a
      status independently of the settings and *always* wrote a complete
      configuration, so three of twelve said `NOT_CONFIGURED` while holding
      every setting they required — contradicting the single fact this page
      exists to establish. `state()` derives it from `required_settings`
      against `configuration`, nothing reads the column for that purpose, and
      the seed now leaves a setting out when it means a row to be unconfigured.
      A blank counts as missing too: a `secret_ref` set to `""` is one somebody
      started and abandoned, and treating it as present is how a check passes
      for something that cannot work
  - **A check verifies the configuration and says it did not contact the
      provider.** Nothing in this template holds real Stripe credentials, and a
      green tick reporting "Connected to Stripe" when no packet left the process
      would be the worst possible lie on a screen whose whole job is to say
      whether things work. So the payload carries `reached_provider: false`, the
      button says "Check settings" rather than "Test connection" — a label is a
      claim before it is even pressed — and the note names the one function to
      replace to make it real. A failed check is recorded as a failed *check*,
      worded so nobody mistakes it for the provider's own message
  - **`enabled` is intent and `state` is outcome, so "switched on and failing"
      exists.** The seed used to set `enabled` *from* the status, so that row
      could never occur — and it is exactly the row an operator opens this
      screen to find. It is counted at the top, sorted first, and marked. A
      single badge saying "error" would not tell a reader whether anybody
      expects the thing to be running
  - **`situation()` is the page's whole argument in one sentence** and is
      asserted directly: "On, and working", "Switched on and failing",
      "Switched on, not connected yet", "Off, and it was failing when it
      stopped", "Needs secret_ref — one setting away from usable". Five states a
      reader can act on, where one word would have been four states they
      cannot
  - **A secret is a reference, redacted by name and not by shape.** A token is
      a string like any other, so guessing by shape would redact a base URL
      that happened to look like one while missing a short key that did not.
      Sending the redaction back means "leave it alone" — otherwise showing a
      masked token once destroys it, which is the trap the settings screen had
      to avoid for the same reason. And the audit row carries the setting
      *names* only: one holding the values would be the secret store nobody
      meant to build
  - **Enabling is refused while settings are missing**, with them named:
      switching on something that cannot possibly work produces a failure with
      no cause, and somebody then spends an afternoon on a token nobody
      entered. Turning one *off* clears a stale CONNECTED, because a screen
      saying "switched off" and "connected" at once is saying two
      contradictory things
  - **`NOT_CONFIGURED` is drawn neutral rather than as a warning.** Eight
      untouched providers in the same colour as the two that are broken makes
      the colour useless (§64)
  - **No create and no delete.** The providers come with the code; an operator
      extends the list by deploying, not by typing a name, and a button
      implying otherwise would be a promise the platform cannot keep (§76)
  - **Four tests were quietly not running.** They looked for a seeded row that
      happened to be incomplete and skipped when every row was complete. They
      clear a required setting themselves now — the same act an operator
      performs — and put it back, which also caught two tests that were editing
      seeded configuration and leaving it changed: the autouse cleanup deletes
      rows a test *created* and cannot un-edit one it changed
  - **And a helper existed all along.** `no-base-to-string` was caught a fourth
      time; the local `text()` added to the fixtures for the third was itself a
      duplicate of `lib/text.asText`, which the file already imported and which
      is *better* — it serialises objects rather than dropping them. The
      mistake was reaching for `String` rather than for the thing already
      there. Also: AntD's Segmented puts `pointer-events: none` on the radio
      and lets the label take the click, which `NotificationsPage.test` had
      already documented

- [ ] **Variety in how "create" opens** — a wizard where the decision has
      parts, a drawer for one object's fields, a plain modal for one question.
      The dashboard wizard is the first; the rest of the modules follow
- [~] **Every page in the navigation is implemented**, not a placeholder — the
      list is in [Phase 6](#phase-6--frontend-pages). `/dashboards`, `/kanban`,
      `/files`, `/workflows`, `/calendar`, `/mail`, `/home` and the
      administration index with `/admin/settings`, `/admin/flags`,
      `/admin/logs`, `/admin/jobs`, `/admin/groups`, `/admin/organizations`,
      `/admin/api` and `/admin/integrations` are done. Remaining:
      `/favorites`, `/import` (§29), `/exports` (§30), `/settings/security`
      (§41) and the two `/showcase/*` pages — every one of which already has
      its model and its seeded rows
- [x] **Six latent e2e flakes fixed, all the same two mistakes.** Four specs
      clicked a select option with `getByTitle`, which AntD also puts on the
      closed select's own label — so the click matched twice as soon as the
      value being chosen was already the current one, which is the state a
      re-run leaves behind. And three specs measured a baseline before the
      thing they were measuring had loaded: a lane count read in the gap
      between the lanes rendering and their queries answering is zero, and
      every later assertion is then measured against a number that was never
      true. Both classes read as product bugs; neither was
- [x] **`docs/` is generated where it can be** — the RBAC permission matrix was
      typed out by hand and had already drifted: `records.comment` shipped with
      the task work page and never reached the table. It is now rendered from
      `core/auth.PERMISSION_GROUPS` by `scripts/render-rbac-matrix.py`, and
      `make lint` fails on a stale document

---

- [ ] **Lanes can be created, renamed and removed** (§18) — on `/kanban`, where
      a lane is a row a person owns. On `/tasks` a lane is the declared status
      vocabulary and stays that way: the board is a view of the work queue, and
      a lane somebody invents there would be a status no filter, chart or
      report has ever heard of
- [x] **`/tasks/:id` is a work page, not a field dump** (§8, §36, §48) — the
      shape the job has, rather than the shape of the row it came from
  - The controls used every day do not open a form: status, priority and
    assignee write on change, through the same endpoint and the same
    optimistic-then-reconciled path the board's drag uses (§73). Everything
    rarer is behind Edit, which is the shared declaration-driven drawer — so
    the page adds a *shape*, not a second way to write a task
  - **Ticking a to-do is an edit to the record.** `checklist` is a declared
    JSON field written by the record endpoint and audited like any other
    change; a "checklist API" would be a second set of rules about who may
    change what, for the same row. The generic form grows a JSON control at
    the same time, so a declared-editable document is editable everywhere
    rather than only on the page that knows what it means
  - **Comments (§36) are polymorphic and reusable.** One `CommentThread`
    addressed by `resource_type` + `resource_id`, because the table is
    polymorphic and a component per entity is five copies of the same
    threading, editing and permission logic. Replies nest one level — what
    people use — rather than arbitrarily
  - **The conversation and the history are kept apart.** Comments are what
    people said; the audit timeline is what the system recorded. One feed
    makes a decision indistinguishable from a side effect
  - `records.comment` is its own permission: a reader who may open the ledger
    is not automatically somebody who may annotate it. An analyst is told so
    in place of a composer, rather than after typing (§76)
  - Adding a permission to the catalogue leaves existing databases unable to
    grant it — `_permissions_for` reads the `roles` table, and seeding refuses
    to touch a populated database. `python -m src.seed --sync-roles` closes
    that, additively: an administrator may have removed a permission from a
    system role deliberately, and reconciling *down* would undo that silently
  - Verification: 14 backend tests (live PostgreSQL) covering the thread, the
    permissions, edit marking, reply scoping, mentions and the checklist's
    validation; 8 frontend tests; 3 Playwright tests proving a comment is
    stored where a colleague can read it, that a ticked to-do survives a
    reload, and that an analyst is told rather than refused
- [~] **Continue implementation task by task** — update this tracker, commit,
      push, redeploy both FE/BE and test the deployed result after each task.
      Current sequence: the detail pages that deserve a shape of their own are
      done, and so is the whole ANALYSE section including `/dashboards`. Next,
      in the order asked for: MinIO-backed files with presigned URLs (§20) and
      the import/export flows on top of them (§29, §30), the QSINT-inspired
      dashboard follow-up, a UI/UX pass over every page, then kanban lane
      CRUD (§18).
      No destructive database reseeding.
  - The local database holds a **small-scale** seed (8 projects, 30 customers,
    50 tickets, 60 orders), not the full one. Nothing depends on which any
    more, but a walkthrough of the charts will look thin until somebody
    reseeds — which is a decision to take deliberately, not on the way past
- [x] **Dark mode is charcoal, not navy** — the slate ramp read as a blue
      theme at low lightness; dark mode now has its own near-neutral ramp
- [x] **Keep this tracker updated after every task**, and commit and push each

---

### Runtime data boundary

- [x] The production frontend contains no fixture/mock datasets and makes no
      authorization decisions from hard-coded roles. Users, organizations,
      permissions and page data come from backend APIs.
      MSW remains test-only infrastructure at the HTTP boundary; it is never
      imported by the application bundle

### Housekeeping

- [ ] Fix the stale `§` references in code comments — `core/cache.py` cites §53
      (that is Data Refresh; caching is unnumbered), `models/business.py` cites
      §61 for monitoring (that is the Page Template Gallery). Harmless today,
      misleading in six months

---

## Design foundations

The rules every screen follows, decided once so eighty screens do not each
decide separately. §59 is the bar: **it must look and behave like a serious
operational enterprise application, not a marketing website.**

### Look and feel

- **Information-dense by default** (§59). Users compare rows; they do not
  admire whitespace. Default table density `middle`; `compact` fits ~40 rows on
  a laptop screen.
- **Colour carries meaning, never decoration.** Status, severity and health are
  the only things that get colour. A row is not blue because blue is nice.
- **One accent** — indigo `#5b5bd6`, the logo's core. Everything else is
  neutral until it means something.
- **Motion is functional and fast.** 120–180ms ease-out for state changes; none
  at all for anything that happens on every keystroke. No decorative animation.
- **Never move the content the reader is looking at.** Skeletons occupy the
  final layout; toasts and banners arrive from the edges.
- **Minimal clicks** (§59). Every list row reaches its detail in one click and
  its common actions in one more.

### Design tokens

- [ ] `theme/tokens.ts` — one source, consumed by the AntD theme, the CSS
      custom properties and the ECharts theme, so the three cannot drift
  - **Colour**: neutral ramp 50→950; accent indigo; semantic `success` `#16a34a`
    · `warning` `#ca8a04` · `danger` `#dc2626` · `info` `#0891b2`
  - **Status palette** fixed per domain vocabulary, so one status is one colour
    on the board, the table and the chart
  - **Type scale**: 12 / 13 / 14 / 16 / 20 / 24 / 30; Inter with a system
    fallback; 14px base, 13px in compact
  - **Spacing**: 4px base — 4 / 8 / 12 / 16 / 24 / 32 / 48
  - **Radius**: 4 controls · 6 cards · 8 modals · 999 pills
  - **Elevation**: four shadows, only for things that float
  - **Acceptance**: changing the accent in one file re-themes the app, the
    charts and dark mode with no other edit

- [ ] Light / dark appearance (§1, §40) via AntD's algorithm on the same tokens
  - **Acceptance**: every route legible in both; no hard-coded hex outside
    `tokens.ts`; persists per user; follows the OS when set to `system`

- [ ] Page density **and** table density as separate settings (§1, §40)
  - **Acceptance**: switching changes row height, control height and font size
    together, persists per user, and never reflows the page layout

### Layout

- [ ] App shell — fixed header 56px, collapsible sidebar 240px / 64px, content area
  - **Acceptance**: sidebar state persists; content scrolls independently of the
    header; no horizontal scrollbar above 1280px at any density
- [ ] Responsive (§56): `<768` mobile · `768–1024` tablet · `1024–1440` laptop ·
      `>1440` desktop
  - **Acceptance**: below 768px the sidebar becomes a drawer and tables become
    cards; no touch target smaller than 44×44px; wide tables scroll
    horizontally with the first column pinned rather than squashing

### States every data view must have (§34)

- [ ] **Loading** — skeleton in the final layout, never a centred spinner
- [ ] **Empty (nothing yet)** — says what would appear here, offers the action
      that creates the first one
- [ ] **Empty (no results)** — distinct from the above; shows the active filters
      and clears them in one click
- [ ] **Error** — what failed, the correlation id, and retry
- [ ] **Forbidden** — which permission is missing, in words
- [ ] **Partial** — a bulk operation that half-succeeded reports both halves
- [ ] Dedicated pages: 401, 403, 404, 500, maintenance, session expired
- **Acceptance**: each state is reachable in the running app and covered by a
  component test

### Accessibility (§55)

- [ ] Keyboard: every action reachable without a mouse; visible focus ring;
      logical tab order; `Esc` closes only the topmost layer
- [ ] Screen readers: landmarks, labelled controls, `aria-live` for async
      results, table headers associated with cells
- [ ] Contrast 4.5:1 body / 3:1 large text and UI boundaries, both themes
- [ ] Honours `prefers-reduced-motion`
- **Acceptance**: axe reports no serious or critical violations on any route;
  primary flows complete with the keyboard alone

### Keyboard map (§54)

- [ ] `Ctrl/Cmd-K` palette · `/` focus search - also see gifr /home/bogdan/workspace/dev/gif_responder for cmdk -> it has more "categories": "On this page" being the most important -> actions to do on the current page.
- **Acceptance**: listed in the `?` dialog; never fires while typing in an
  input; disabled while a modal owns the keyboard

---

## Testing strategy

Three levels, each with a job. A test that needs the whole stack to check a pure
function is a slow test that fails for unrelated reasons.

| Level | Tool | Scope | Runs against |
| --- | --- | --- | --- |
| **Unit** | pytest · vitest | One function, one component: filter compilation, RAQB → SQL, permission maths, formatters, hooks | Nothing external |
| **Integration** | pytest + Flask test client · RTL + MSW | One endpoint end to end, or one page against a mocked API | Seeded PostgreSQL / mocked HTTP |
| **E2E** | Playwright | A whole journey through the real stack | `docker compose up` with Keycloak and the seed |

### Backend

- [x] Harness runs with **no** database, cache or Keycloak present — dependencies
      point at a closed port so they are refused in a millisecond;
      `TEST_DATABASE_URL` enables the `database`-marked tests
- [x] Endpoint-map contract check compares Flask converters with their OpenAPI
      parameter form, so typed UUID routes are covered by the drift test
- [ ] **Every endpoint** has an integration test covering five cases: happy
      path, validation failure, 401 without a token, 403 with the wrong role,
      404 for a missing id
- [ ] `core/query.py` — one unit test per operator per field kind, plus the
      subtle ones: "excluding a value must not exclude rows that have none",
      "empty means empty *or* absent", case-insensitive text equality
- [ ] `core/rules.py` — tree → SQL and tree → text asserted to describe the same
      thing (§51); depth and rule-count limits enforced; a half-built rule is
      skipped rather than blanking the result set
- [ ] `core/auth.py` — verification against a fake JWKS, key rotation self-heal,
      role → permission resolution, impersonation, and that permissions come
      from the database rather than the token
- [ ] `core/audit.py` — the diff, redaction of secret-shaped keys, and that an
      audit row rolls back with the change it describes
- [ ] `core/pagination.py` — page envelope, keyset cursor round-trip, and that a
      malformed cursor is a 400 not a 500
- [x] Seed — determinism, referential consistency, volume targets
- **Acceptance**: `pytest` green in both modes; no endpoint ships without its
  five-case test

### Frontend

- [x] Vitest + React Testing Library + MSW, mocking at the network boundary so
      tests exercise the real client rather than a stubbed module
- [ ] Unit: formatters, URL-state serialisation (§72), permission hooks, query
      builder value coercion, keyboard handlers
- [ ] Component: every state in [States](#states-every-data-view-must-have) for
      the table, detail page, form and chart wrappers
- [ ] Contract: the generated client matches `/swagger.json` — a drift check in CI
- **Acceptance**: `npm run test` green; `npm run typecheck` clean under
  `strict: true`; `npm run build` produces no chunk above 500KB gzipped without
  an explicit exemption

- [x] **Lint** — `eslint.config.js` exists and `make lint` runs it. Type-aware
      rules only, and only ones that catch defects a type checker cannot see: a
      floating promise, a hook whose dependencies drifted, a comparison that is
      always true. No stylistic rules — a lint run that spends its output on
      quote characters trains people to skim it. Errors fail the run; warnings
      advise, and the places a warning is wrong carry a comment saying why

### End to end — Playwright

- [x] Harness: `docker compose up`, seed, then run against the real stack with
      real Keycloak sign-in
  - Personas are signed in once by a `setup` project and their sessions replayed
    (`e2e/auth.setup.ts`). The realm is `bruteForceProtected`, so a suite where
    every test signs in for itself locks the account as soon as it runs in
    parallel — which is the default
- [ ] **Personas** (§58) — each of the five signs in and sees the navigation
      their role allows; `viewer` cannot reach `/admin/*` and is told which
      permission is missing
- [ ] **List → filter → sort → paginate** (§3, §7, §52) — row count changes and
      the URL round-trips
- [ ] **Advanced search** (§4, §51) — build a nested condition, open the query
      inspector, save it (§5), reopen it, get the same rows *and* columns
- [ ] **CRUD** (§8, §9) — create, edit, delete; the audit trail shows all three
- [ ] **Wizard** (§10) — save a draft midway, resume it, complete it
- [ ] **Bulk operation** (§43, §75) — select across pages, see the affected-count
      preview, confirm, read the partial result
- [ ] **Import** (§29) — upload CSV, map columns, preview errors, execute,
      download the error report
- [ ] **Export** (§30) — request one above the row limit, watch it become a job
      (§23), download the artefact
- [x] **Impersonation** (§12) — admin impersonates a viewer, sees the reduced
      UI, and both identities appear on the audit row
- [ ] **Command palette** (§31) — `Ctrl-K`, navigate to a record, run a page action
- [ ] **Audit explorer** (§21) — filter by actor and action, open an entry, read
      the before → after diff
- [x] **Email** (§14–§16) — read a thread, reply, save a draft, send
- [ ] **Kanban drag** (§18) — move a card, reload, it stayed
- [ ] **Unsaved changes** (§74) — edit a form, navigate away, get the guard
- [ ] **Deep link** (§69) — paste a filtered-table URL as another user, same view
- [ ] **Appearance** — toggle dark mode and density, reload, both persisted
- **Acceptance**: green from a cold `docker compose up` on a machine that has
  never run it

---

## Feature matrix (§1–§77)

Every section of the spec, its home in the app, and its state. `—` means the
section is a cross-cutting rule rather than a page.

| § | Feature | Route / where | API | State |
| --- | --- | --- | --- | --- |
| 1 | Application shell, navigation | all | `/meta/*`, `/api/me` | [ ] |
| 2 | Overview dashboard, KPIs, charts | `/`, `/analytics` | `/dashboard/*`, `/api/analysis/*` | [~] |
| 3 | Advanced data table | `/showcase/table` + every list | generic list | [ ] |
| 4 | Advanced search (simple + RAQB) | `/explore` | `/api/explorer/query` | [x] |
| 5 | Saved searches | `/explore` (panel) | `/api/saved-searches` | [x] |
| 6 | Search results, view modes | `/explore` | `/api/explorer/query` | [x] |
| 7 | Entity list pages | `/{entity}` ×6 | generic list | [x] |
| 8 | Entity detail page | `/{entity}/:id` | `/api/records/…` | [x] |
| 9 | Create / edit forms | drawer on every entity page | `/api/records/*` | [x] |
| 10 | Multi-step wizard | `/{entity}/new/wizard` | draft endpoints | [ ] |
| 11 | Admin area | `/admin` | `/admin/*` | [x] |
| 12 | User management, impersonation | `/admin/users` | `/admin/users` | [x] |
| 13 | Roles and permission matrix | `/admin/roles` | `/admin/roles` | [x] |
| 14 | Email inbox | `/mail` | `/api/mail/threads` | [x] |
| 15 | Email detail, threading | `/mail?thread=…` | `/api/mail/threads/:id` | [x] |
| 16 | Compose email | `/mail` (composer) | `/api/mail/messages` | [x] |
| 17 | Notification centre | header + `/notifications` | `/notifications` | [x] |
| 18 | Tasks / work queue (kanban) | `/tasks`, `/tasks/:id` | `/api/records/task` | [~] board, drag, card detail |
| 19 | Calendar | `/calendar` | `/api/calendar/events` | [x] |
| 20 | File manager | `/files` | `/api/files` | [x] |
| 21 | **Audit logs** | `/admin/audit` | `/admin/audit` | [x] |
| 22 | System logs | `/admin/logs` | `/admin/logs` | [x] |
| 23 | Background jobs | `/admin/jobs` | `/admin/jobs` | [x] |
| 24 | System health | `/admin/health` | `/health/status` | [x] API |
| 25 | API management | `/admin/api` | `/admin/api-clients` | [x] |
| 26 | Integrations | `/admin/integrations` | `/admin/integrations` | [x] |
| 27 | Feature flags | `/admin/flags` | `/admin/flags` | [x] |
| 28 | Reports | `/reports`, `/reports/builder` | `/api/reports`, `/api/analysis/run` | [x] |
| 29 | Import wizard | `/import` | `/imports` | [ ] |
| 30 | Export | every list | `/{list}/export` | [~] |
| 31 | Command palette (`cmdk`) | global | `/search/quick` | [ ] |
| 32 | Global search | header + `/find/global` | `/api/search/global` | [x] |
| 33 | Drawers and modals | — | — | [ ] |
| 34 | Error and empty states | `/errors/*` | — | [ ] |
| 35 | Activity feed | `/activity` + detail tabs | `/activity` | [ ] |
| 36 | Comments | `/tasks/:id`, detail pages | `/api/comments` | [~] |
| 37 | Tags and labels | `/admin/tags` + inline | `/tags` | [ ] |
| 38 | Favorites | `/favorites` | `/favorites` | [ ] |
| 39 | Recent items | sidebar + `/recent` | `/recent` | [ ] |
| 40 | Personal preferences | `/settings/preferences` | `/api/me` | [x] |
| 41 | Security settings, sessions | `/settings/security` | `/api/me/sessions` | [ ] |
| 42 | Organization settings | `/admin/organizations` | `/admin/organizations` | [x] |
| 43 | Bulk operations | every list | `/{entity}/bulk` | [ ] |
| 44 | Drill-down | dashboard, analytics → list | `/api/analysis/run` | [~] |
| 45 | Dashboard builder | `/dashboards` | `/api/dashboards` | [x] |
| 46 | Saved views | every list | `/saved-views` | [ ] |
| 47 | Data comparison | `/{entity}/compare` | generic list | [ ] |
| 48 | Timeline view | detail tabs | `/api/audit/timeline` | [~] |
| 49 | Alerts and rules | `/workflows` | `/api/automations/rules` | [x] |
| 50 | Data relationships | detail tabs + `/find/relationships` | `/api/relationships/*` | [~] |
| 51 | Query inspector | `/explore` | — (`core/rules.py`) | [x] |
| 52 | Pagination patterns | various | `core/pagination.py` | [x] core |
| 53 | Data refresh, auto-refresh | data-heavy pages | — | [ ] |
| 54 | Keyboard navigation | global | — | [ ] |
| 55 | Accessibility | global | — | [ ] |
| 56 | Responsive behaviour | global | — | [ ] |
| 57 | Realistic demo data | — | `src/seed/` | [x] |
| 58 | Demo roles / personas | — | `core/auth.py` | [x] core |
| 59 | UX quality bar | global | — | [ ] |
| 60 | Component showcase | `/showcase/components` | — | [ ] |
| 61 | Page template gallery | `/showcase/templates` | — | [ ] |
| 62 | Master / detail layout | `/showcase/master-detail` | — | [ ] |
| 63 | Split view | mail, logs, files, tasks | — | [ ] |
| 64 | Table row preview drawer | every list | — | [ ] |
| 65 | Data quality indicators | lists + `/admin/quality` | — | [ ] |
| 66 | Dashboard alerts | `/` | `/dashboard/alerts` | [ ] |
| 67 | Customisable home page | `/dashboards` | `/api/dashboards` | [x] |
| 68 | Navigation history | global | `/recent` | [ ] |
| 69 | Deep linking | global | — | [ ] |
| 70 | Search within table data | every list | generic list | [ ] |
| 71 | Server-side data model | — | `core/query.py` | [x] core |
| 72 | Query state persistence | global | — | [ ] |
| 73 | Optimistic vs confirmed actions | board, forms | — | [~] |
| 74 | Unsaved changes protection | every form | — | [~] drawer |
| 75 | Preview before bulk execution | every bulk action | `/{entity}/bulk/preview` | [ ] |
| 76 | Security-conscious UX | global | `core/auth.py` masking | [x] core |
| 77 | Final goal — coherent template | everything | — | [ ] |

---

## Advanced search and saved searches (§4, §5, §6, §51)

The single most important feature in the template, and the one the reference
project only sketches. gif_responder has saved searches as *name + filters*;
Nucleus extends that to a full condition tree with a real sharing model.

### The query builder (§4)

- [x] **RAQB (`@react-awesome-query-builder/antd`) as the editor**, configured
      from the field catalogue the backend publishes — `FieldSet.describe()`
      already returns name, label, kind, the operators that kind allows, and
      the choices for enums
  - **Acceptance**: the builder can never offer an operator the backend will
    reject, because both read the same declaration. Adding a filterable column
    to an endpoint makes it appear in the builder with no frontend change
- [x] **Rules and groups**, nested arbitrarily:
      `CONDITION AND ( CONDITION OR CONDITION )`
  - AND / OR conjunction per group, and group negation (`NOT`)
  - add rule · add group · remove · duplicate (a per-node control, attached by
    wrapping each item — the library's own action bar has no extension point)
  - **drag-and-drop reordering** of rules within and between groups
  - field-specific operators, switching when the field changes
  - **Acceptance**: a tree twelve levels deep is rejected with a message, not a
    stack overflow (`core/rules.py` caps depth at 12 and rules at 200)
  - Adding a rule used to do nothing at all: the tree round-tripped through the
    URL and the library discards empty rules on load. The editor now owns the
    tree while it is being edited (`AdvancedQueryBuilder`)
- [x] **The full operator vocabulary**, per field kind — equals, not equals,
      contains, does not contain, starts with, ends with, greater/less than
      (or equal), between, before, after, in, not in, is empty, is not empty,
      exists, does not exist
  - **Acceptance**: every operator in `core/query.py::OPERATORS` is reachable
    from the UI for at least one field kind, and a unit test asserts the two
    lists agree — `queryBuilderConfig.test.ts` asserts it in both directions,
    including that no offered operator is one the library's own widget type
    cannot render (which is how select fields shipped with an empty operator
    dropdown), and `tests/test_rules.py` asserts the backend half
  - Translation is per field kind, not global; text and number are lent the
    multiselect widget so `in`/`not_in` stay reachable for them
- [x] **Live result count** as the tree is edited, debounced and cancellable
  - **Acceptance**: a half-built rule does not blank the results — `compile_tree`
    skips incomplete rules by design, and the UI must not fight that
- [x] **The editor holds a draft; `Search` runs it.** The count beside the
      button previews the draft through the same endpoint that will run it, so
      the number promised is the number that arrives, while the page behind the
      drawer keeps the last question that was actually asked. Closing without
      searching changes nothing. `Save as…` names the draft (§5) and runs it,
      because a saved name that refers to rows nobody can see is not trusted
- [x] **Query inspector** (§51) — the parenthesised, indented rendering of the
      current tree, shown beside the builder
  - **Acceptance**: the text comes from `describe_tree`, the SQL from
    `compile_tree`, both walking the same structure — so the inspector provably
    cannot drift from what executed. Asserted by
    `test_rules.py::test_the_inspector_names_every_field_and_operator_the_sql_uses`,
    which compiles and describes one tree and compares what each mentions
  - An e2e test reads the inspector's sentence back after building the rule in
    the editor, so the assertion covers the round trip, not just the function
- [x] Simple search alongside it (§4): one box across every `searchable` field,
      with recent searches, autocomplete, highlighted matches and history
  - **The box searches the dataset on screen and offers matches from every
    other one** (§32): the rows behind it narrow as the term is typed, and the
    dropdown answers the question the reader has when nothing comes back — the
    record exists, it is simply not a task. Selecting one opens it in its own
    dataset; "See every match" hands the term to `/find/global`
  - The facet menus below it are gone. Per-field narrowing belongs to the
    condition builder beside the box, which does it better in every respect —
    any field, any operator, negation, nesting — where the facet row offered
    three fields chosen for you and cost a `GROUP BY` per field on every
    keystroke. Facets are still computed, on request (`"facets": true`)
  - Recent searches are the only suggestion offered, and per dataset: a
    suggestion drawn from the data guesses what the reader meant from a prefix,
    and guessing wrong in a search box is worse than not guessing. They live in
    the browser, not in a table of everything everyone ever typed
  - Matches are marked with `<mark>` in the fields the server actually searched
    — the response echoes both the executed term and the searchable field list,
    so a highlight is evidence of a match rather than a coincidence
- [x] Simple and advanced conditions compose rather than replacing each other;
      opening either editor preserves the other part of the question

### Saved searches (§5)

A saved search stores the *question* and the *presentation*: conditions, sort,
visible columns, page size and view mode. Opening one that finds the right rows
and then shows the wrong columns is a saved search nobody trusts.

- [x] Fields: name, description, owner, created, last modified, condition tree,
      rendered condition text, default sort, visible columns, page size, view
      mode, favourite flag, use count, last used
- [x] Actions: create · rename · edit · duplicate · delete · favourite · run
  - One form for creating and editing, because they ask the same questions and
    a create dialog that omits sharing teaches people it lives somewhere else.
    The panel filters by name, condition or owner, and shows only the actions
    the API will allow — a member sees Open and Duplicate, an owner also sees
    Edit, Favourite and Delete
- [x] **A module of the search screen, not a page of its own** (as in
      gif_responder's `SavedSearchControls`): a panel on `/explore` listing
      them with rule count and condition summary, and opening one loads it
      into the builder in place. `/search` and `/search/saved` redirect there, so an old
      link still works
- [~] **Sharing model** — three states, and one rule about who may change what:

  | Visibility | Who can see it | Who can edit or delete it |
  | --- | --- | --- |
  | **Private** (default) | the owner only | the owner |
  | **Shared** | the owner **plus explicitly added members** | the owner |
  | **Public** | anyone signed in | the owner |

  - A new saved search is **Private**. Nothing is shared by accident.
  - The owner adds individual members by name or email; each added member gets
    read access and can run the search, nothing more.
  - The owner may flip it to **Public**, at which point every signed-in user can
    see and run it. Member entries are kept, so flipping back to Shared restores
    exactly the previous audience rather than losing it.
  - **Only the owner may edit, rename, re-share or delete.** A member who wants
    their own version duplicates it, and the copy is theirs and Private.
  - Transfer of ownership is an explicit action, audited (§21).
  - **Acceptance**: a member cannot `PUT` or `DELETE` someone else's saved
    search — 403 with the reason, asserted by an integration test. A private
    search does not appear in another user's list, is not reachable by direct
    id, and is not found by the command palette's "Quick views" group.
    Sharing, unsharing and visibility changes each write an audit row
  - Shipped end to end. `searches.share` is enforced rather than merely
    defined: OPERATOR and VIEWER keep their own searches and publish nobody's,
    and they are told so in the form rather than by a 403 after typing a name.
    Members are picked from `GET /api/directory/people`, the same control every
    "who should see this" question will use. Transfer is its own audited
    action, and leaves the previous owner a member — losing sight of a search
    the moment you hand it over is not a handover anybody would risk making.
    Two signed-in browsers assert the rules in `e2e/saved-searches.spec.ts`

- [x] `resource_shares` table — polymorphic (`resource_type`, `resource_id`,
      `user_id`), the same pattern as comments, tags and favourites, so saved
      views (§46), dashboards (§45) and reports (§28) can adopt it unchanged
  - **Acceptance**: unique on (resource, user); removing a user cascades their
    shares; a share never grants edit

- [x] The list query resolves visibility in **one** statement —
      `owner = me OR scope = PUBLIC OR id IN (my shares)` — not by fetching
      everything and filtering in Python (§71)
  - **Acceptance**: the generated SQL contains the visibility predicate; a
    user with no shares and no public searches issues the same single query

### Search results (§6)

- [x] Four view modes — list · table · card · compact — switchable and remembered
- [x] Match highlighting, metadata, tags, timestamps, status. Relevance ranking
      belongs to `/find/global`, where results from several entities have to be
      ordered against each other
- [x] Result grouping, sorting, preview drawer (§64) and quick actions
  - Grouping is offered for faceted fields only — a list grouped by "Title"
    has one section per row — and each heading counts that value's share of
    the **whole** result rather than the rows on screen, so the sections still
    add up to the total when only the first page has loaded
  - The sections themselves come from the facet counts, not from the loaded
    rows. Built the other way round, a group with nothing on the first page
    disappeared entirely: at 500 tasks the 34 blocked ones had no row among the
    first 25, so the breakdown quietly omitted part of the answer while still
    claiming to be a breakdown of it. A counted-but-unloaded section now says
    so. The `small` seed hid this, because 25 of 60 tasks happened to contain
    every status — a reminder that a demo dataset small enough to be convenient
    is a dataset that agrees with whatever the code does
  - The preview's actions are the three that belong there: copy the id, copy a
    link to this exact view, and follow the record's connections (§50)
- [x] Both pagination strategies (§52): numbered for the table, "load more" for
      the card and list modes
  - Accumulated rows are dropped the moment the question changes, so a list
    never mixes the answers to two questions

---

## Modules added after the first pass

Requested during the build, and specified here so they are tracked like
everything else.

### `/analytics` and discovery workspaces (§2, §32, §44, §50, §65, §71)

- [x] Navigation and deep-linkable route shells for Analytics, Data Explorer,
      Global Search, Relationship Explorer and Data Catalog
- [~] `/analytics` — cross-entity KPIs, trends, comparisons and drill-down with
      one shared period/filter context; analyses can become reports, charts or
      dashboard widgets
  - Shipped: the workspace, on one analysis endpoint shared with the builders.
    Dataset, period, grouping, granularity, measure and chart kind live in the
    URL; the headline, the trend, the breakdown and the composition are four
    `GROUP BY`s of one query, so they cannot disagree about what they measured
  - "Save as a report" hands the current context to the report builder (§28),
    which is the half still to come
- [~] `/explore` — the canonical home for simple search, nested advanced
      search, query inspection, saved searches, saved views and result modes;
      legacy `/search*` URLs redirect here
  - Shipped: six declarative datasets, server-side simple/faceted/advanced
    query, URL state, configurable columns, four result modes, saved-search
    lifecycle and legacy redirects. Saved views and the remaining saved-search
    sharing UI are next
- [x] `/find/global` — ranked cross-entity results with highlighted matches,
      recent queries and keyboard navigation
  - Reuses the explorer's resource declarations, so there is no second list of
    datasets to keep in step and one the caller may not read is not searched
    rather than searched and filtered afterwards
  - Ranking is computed in PostgreSQL and *explainable*: exact beats prefix
    beats contains, an earlier-declared field beats a later one, and every hit
    returns the field that matched with the text around it. A cross-entity list
    that cannot explain its own order is one nobody scrolls past the first row
  - ↑/↓ walk the flattened results across group boundaries, Enter opens the
    highlighted one, and a group hands its term to Data Explorer
- [x] `/find/relationships` — a **graph-analysis page** first and a traversal
      tool second: it opens on the connection map rather than an empty search
      box, then follows any record's links in both an accessible list and a
      visual graph without losing the exploration trail
  - The connections are **derived from the schema**: every link is a foreign
    key that already exists, so adding a column with a `ForeignKey` makes the
    relationship appear and removing one makes it disappear. A hand-written
    adjacency list is a second description of the database, wrong the first
    time anybody migrates
  - Outbound is one row per key that is set; inbound is counted in full and
    sampled — a customer has three hundred orders, and the useful answer is
    "300, here are the newest eight" with a link to all of them in the explorer
  - The trail is in the URL: every hop is pushed, the breadcrumb walks back to
    any earlier record, and the whole path can be pasted to somebody else
  - **The graphs are D3.** One `ForceGraph` component draws all three pictures
    on the page — the clustered record network, the map of entity types and one
    record's ego network — with `d3-force` for layout, `d3-zoom` for the camera
    and `d3-drag` for the hands. React owns the container and nothing inside
    it, which is the only division of labour between the two that does not
    fight. The layout is seeded deterministically and settles to the same
    arrangement twice; under `prefers-reduced-motion` it is solved to
    convergence before the first paint and never animates
  - **Communities are detected on the server** (`core/graph.py`, Louvain).
    Clustering in the browser would give every viewer a different answer to the
    same question, and a partition nobody can cite is not an analysis. Label
    propagation was tried first and rejected: on a graph of dense clusters
    joined by a few shared people, one label wins a tie at a bridge and
    avalanches until everything is one community — an answer that looks like an
    answer. `/api/relationships/network?focus=` returns nodes, edges,
    communities and **Newman's modularity**, so the page can say how much of
    the structure is real rather than implying certainty
  - The network is built in three bounded steps — anchors (the records most
    rows point at), one hop in capped *per anchor* by a window function so one
    enormous customer cannot spend the whole budget, and one hop out, which is
    what produces the **bridges** between clusters. Edges are then derived from
    the final node set, so the picture can never contain a line to something
    that was cut
  - Every cluster is also a row in a table: named after its most connected
    member, with its entity mix, its size and how many links leave it. A
    coloured blob is not a finding, and not everybody sees colour (§55)
  - **The landing state is an analysis, not a prompt.**
    `/api/relationships/overview` returns the whole map — entities sized by
    record count, every foreign key weighted by how many rows actually carry
    it, and the records the most rows point at. An explorer that opens on a
    search box only helps somebody who already knew what they were looking for
  - **Coverage is the finding.** "600 tickets, 310 of which name a customer" is
    a different fact from "tickets have customers", and the other 290 are
    usually what somebody came to see. Every relation shows the share of rows
    carrying it, and a thin one is flagged rather than left to be noticed
  - Hubs come from one `GROUP BY` per profiled relation rather than a count per
    record: asking "how connected is this customer?" of three hundred customers
    one at a time is three hundred round trips for a panel nobody would wait for
- [x] `/find/catalog` — entities and fields with types, allowed operators,
      freshness, completeness and links into Data Explorer
  - Generated from the same `Resource` declarations the explorer, the builder
    and global search read, so an entry cannot describe a field that is not
    there or omit one that is. A catalogue kept by hand is wrong within a month
  - Completeness is **measured**: one aggregate per dataset counts every
    column's non-NULL rows in a single pass, and the percentage is shown beside
    the count it came from. Notes say what a reader should know before trusting
    a dataset — a sparse field narrows results twice — as observations, not
    judgements
  - `?field=` returns the values a field actually holds, most common first:
    the declared choices are what the code allows, this is what the data has

### `/kanban` — boards, cards, drag (§18, §33, §36)

- [ ] Model: `kanban_boards` → `kanban_lanes` → `kanban_cards`, plus
      `kanban_card_items` (the card's to-do list). Comments reuse the existing
      polymorphic `comments` table; attachments reuse `files`
  - Cards carry `position` **and** `lane_id`, so a drag is one UPDATE and a
    reload restores exactly what the reader left
- [ ] Board CRUD, lane CRUD, card CRUD
- [~] **Drag a card between lanes and within a lane.** Optimistic on the client,
      reconciled against the server's answer (§73)
  - Lane-to-lane ships on `/tasks`, on the task's own `status` rather than a
    board table: the board is a view of the work queue, and a second copy of
    "which lane is this in" is a second answer to the question. Ordering
    *within* a lane waits on `board_position`, which the model already carries
  - **Acceptance**: met for the lane change and asserted end to end — a card
    moved and reloaded is where it was dropped, a refused move snaps back and
    says why, and a stale edit is refused with a 409 rather than applied
- [~] Card detail: description, assignee, due date, labels, **to-do checklist**
      with per-item completion, **comments** with mentions, attachments,
      activity timeline
  - Shipped on `/tasks/:id`: description, checklist with per-item completion,
    assignee, dates, effort, comments with mentions and one level of replies,
    and the audit timeline. Labels and attachments wait on §37 and §20
  - **Acceptance**: met for the checklist and the conversation — ticking an
    item writes the record and the progress moves with it, without a reload.
    Counts on the card face are still open
- [ ] Filters: assignee, label, due, text — applied server-side (§71)
- [ ] Keyboard: move a card between lanes without a mouse (§54, §55)

### `/notifications` — the notification centre, live (§17)

- [x] A page listing every notification: category, severity, actor, resource,
      timestamp, read state — with all six data states (§34), URL-backed
      filters (§69, §72) and its actions in the command palette's "On this
      page" group
- [x] **Mark one as read** and back again, **mark all as read**, mark one
      collapsed group read, and delete
- [x] **It reads as a feed, not a table.** Three things do that work:
  - A **digest strip** — unread, critical, needs-you, last 24 hours — where
    each tile is also the filter for the thing it counts, so the summary and
    the way to act on it are one control. Every number is a server-side
    aggregate over the whole mailbox: "4 critical" computed from the loaded
    page would mean "4 critical among these twenty-five", which is wrong
    exactly when there are many
  - **Rows under the day they arrived on.** Forty rows each stamped "3d ago"
    is a wall of text; the same rows under *Today* / *Yesterday* / *Monday*
    let the eye find the boundary between "while I was here" and "before I
    arrived" without reading one of them. The grouping is a presentation of
    the order the server already returned, never a re-sort, so a day header
    cannot appear twice
  - **Unread is a tinted card with an accent edge**, not bold text alone: the
    state has to survive being skimmed from two feet away. Severity is the
    tint and category is the glyph — two channels, so a reader who cannot
    separate the colours still reads the kind (§55)
- [x] Filter by category, severity, read state and text; group by `group_key`
      so twelve "assigned you a task" rows collapse into one
  - Grouped **in PostgreSQL**, not in the browser: one statement with window
    functions returns the newest member of each group plus how many it stands
    for. A page that groups the twenty-five rows it happens to have downloaded
    reports "3 of a kind" for something the server would have called thirty
  - A row with no `group_key` falls back to its own id, so a one-of-a-kind
    notice is its own group rather than disappearing into an "ungrouped" pile
- [x] **Live over WebSocket (`wss://`)** — a new notification appears without a
      reload, and the header badge updates with it
  - Backend: a WS endpoint authenticated by the same access token, scoped to
    the signed-in user; heartbeats; server-side fan-out on write
  - Client: one socket for the whole app, reconnect with backoff, a silence
    watchdog, and **polling as the fallback** — every notification query drops
    to a timer the moment the socket is not carrying updates, and the page says
    which of the two it is rather than looking live while being stale
  - Delivery **invalidates** rather than merges: the server stays the single
    authority, so a reconnect that missed a message, a second tab and an
    in-flight mark-read cannot leave the cache disagreeing with the database
  - Two things had to be fixed for the socket to survive the real stack, and
    both failed silently into "it still works, just by polling":
    * nginx forwards `Upgrade`/`Connection` and holds the socket open for an
      hour, rather than closing it on the 120s read timeout
    * the server **selects** the `bearer` subprotocol the browser offers. A
      `WebSocket` constructor cannot set an `Authorization` header, so the
      token rides in the subprotocol — and RFC 6455 makes the client fail any
      handshake accepted without one of the protocols it offered. The socket
      opened, authenticated, and was dropped by the browser a millisecond later
  - **Acceptance**: met — the e2e suite asserts the page reads "Live" against
    the compose stack (so the handshake, the proxy and the token path all
    work), that marking read and unread moves the count both ways, and that
    one reader cannot reach another's notification by id. A backend
    integration test asserts the scoping directly rather than by inspection

### Appearance — the dark ramp

- [x] Dark mode has its own palette (`INK`) rather than the light slate ramp
      inverted
  - Slate's blue cast is invisible at 95% lightness and unmissable at 8%: a
    surface built from `NEUTRAL[900]` reads as navy, and the whole product
    looks like it has a blue theme nobody asked for. `INK` is almost
    achromatic, so the only things carrying hue in dark mode are the accent and
    the status colours — which is the only thing that should
  - Shadows have their own dark set. A translucent-navy shadow over a charcoal
    surface is invisible; depth in a dark UI comes from a *darker* shadow
  - The accent lightens to `ACCENT[400]` in dark mode. An accent that has to be
    hunted for is not an accent
  - One ramp, three consumers: the AntD theme, the CSS custom properties and
    the ECharts theme all read it, so a table and the chart beside it cannot
    drift

### `/profile` — the user's own page (§40, §41)

- [ ] Header: avatar, name, role, organization, department, joined, last seen
- [ ] Tabs: overview · activity · security · preferences
- [ ] Personal analytics, in the style of gif_responder's profile: tasks
      completed over time, throughput by week, an activity heatmap by day,
      and the record types they touch most
- [ ] Their own recent activity, favourites, saved searches and sessions
- [ ] A public view of another user at `/profile/:username`, showing only what
      the viewer's permissions allow

### `/settings/preferences` — the reader's own settings (§40)

- [x] Stored **on the server**, against the account, and applied automatically
      on the next visit — from another browser, another machine, or an
      administrator viewing the platform as that person (§12)
  - A preferences page that only changes what is on the preferences page is a
    form. What makes these preferences is that they are read by the parts of
    the app that never mention them: the timestamp in an audit row, the page
    size of a list nobody configured, the address the logo points at
  - **Date, time and number formats** reach every rendered value through
    `lib/formats`, a module store with exactly one writer. A React context was
    rejected because half the consumers are not components — `lib/time.ts` is
    imported by plain functions, and a hook cannot be called from one
  - `Intl` has no "give me exactly this pattern" mode, so a chosen pattern is
    rendered by the locale whose conventions *are* that pattern. Hand-rolling
    the formatting is how applications end up printing `13/13/2026`
  - **Rows per page** is the default `useEntityView` starts from, unless the
    page's own shape needs another (a card grid of twenty-five leaves a ragged
    last row) or the reader has already paged, which the URL records
  - **Home page** is where `/` lands and where the logo goes. Read from the
    profile rather than a router constant, and it *waits* for the profile:
    redirecting to the dashboard and then again once preferences load would put
    a page in the back button nobody asked for
  - Changes save on the spot rather than behind a Save button. These are
    per-reader and instantly reversible, which is the opposite of the
    permission matrix's staged-then-confirmed edits (§73) — and a Save button
    on a preferences page is mostly a way to lose a change
  - Theme and density keep their localStorage fast path so the first paint does
    not flash the wrong one; the server copy wins the moment the profile loads.
    One writer each: `AuthProvider` owns appearance, `PreferencesProvider` owns
    the rest, because two writers of one field is a race
  - **Acceptance**: met end to end — an e2e test sets a format, opens the
    account in a browser context with no storage at all, and finds an audit
    row rendered in it

### `/files` — object storage on MinIO (§20)

- [x] MinIO added to the compose stack, with a bucket created on first boot
  - Created by the API on boot (`storage.ensure_bucket`) rather than by an init
    container: it is idempotent, it is one fewer service to wait on, and a
    fresh volume then just works
  - **Two endpoints, and the distinction is what makes presigning work in
    Docker.** The API signs and reaches MinIO over the compose network; the
    *browser* follows the URL on an address that exists outside it. Two boto3
    *clients* rather than one and a string substitution, because an SigV4
    signature covers the Host header — rewriting the host of a signed URL is
    how the first version produced `SignatureDoesNotMatch` on every download
- [x] Backend storage service behind one interface, so MinIO is swappable for
      S3 or a local volume without touching a handler
  - `core/storage.py` publishes four questions and two implementations.
    `ObjectStorage` talks S3; `LocalStorage` writes to a directory and signs
    its own URLs with the application secret, so `python main.py` works with
    nothing else running and the test suite needs no container
  - The local one is **not a lesser implementation pretending to be S3**. It
    answers the same four questions and is honest about the difference: its
    URLs are served by this process, so the bytes *do* pass through it. The
    health endpoint reports *which store is answering* for exactly that
    reason (§24) — a deployment on the fallback by accident should be able to
    see it
  - A storage key is **generated, never taken from the client**, and
    `key_for` refuses a relative segment where every key in the platform is
    built. A key made from a filename is a key somebody can aim at another
    object with `../`, and sanitising a path is a game nobody wins twice
- [x] **Presigned URLs** for upload and download — bytes never pass through the
      API process, which is what keeps a 200MB upload from occupying a gevent
      worker for the duration
  - **An upload is therefore two phases.** The API cannot see the transfer, so
    a file is created `UPLOADING` beside its URL and only becomes `READY` when
    `confirm` has checked the object is there with `stat`. Trusting the
    client's "done" would mean a file list full of rows with nothing behind
    them, which is worse than an upload that visibly failed
  - A refused extension or an oversized file is refused **before a URL is
    issued** — after 400 MB have moved is the wrong moment to say no
  - A download is an anchor following a signed URL, not `window.open`: the URL
    carries `Content-Disposition: attachment`, and a popup for a download is
    what popup blockers exist to stop
- [x] Multi-file drag-and-drop upload with per-file progress; move, rename,
      delete
  - **Per-file progress, not one spinner.** A drop of forty files with a single
    indeterminate bar is a page somebody watches for four minutes wondering
    whether it is stuck. `XMLHttpRequest` in exactly one place in the product,
    because `fetch` has no upload-progress event
  - Renaming and moving leave the object where it is: a storage key is an
    address, not a path, and moving bytes to make a tree look tidy is a copy
    and a delete for something no reader ever sees
  - **Acceptance**: met and asserted end to end against the running MinIO — the
    PUT goes to `:9000` and never to `/platform/api/`, the bytes that come back
    are the bytes that went in, a delete removes the object as well as the row,
    a refused upload transfers nothing at all, and a viewer is told which
    permission uploading needs
- [x] **The seed writes real bytes**, so a download is a file rather than a 404
  - `--sync-files` materialises them, idempotently, which also repairs a
    database seeded before object storage existed
  - The file-type catalogue was narrowed to formats `seed/blobs.py` can
    genuinely produce. A `.xlsx` whose bytes are plain text looks fine in a
    list and fails in the application the reader opens it with — eight formats
    somebody can actually download beat twelve they cannot
- [ ] Preview for images, PDF and text, and copy — the preview pane waits on
      §63, and copy is the one verb of the four not yet wired

### Configurable dashboards, shared like saved searches (§45, §67)

- [x] `/dashboards` — the reader's own dashboards, plus the ones shared with them
  - **`/dashboard` is *the* dashboard; this is the other thing.** One is a fixed
    layout the platform designed to demonstrate what it can answer; the other
    is a layout somebody composed for the job they actually do
- [x] Builder: add · remove · **resize** · **reorder** · configure widgets on a
      12-column grid
  - **Editing is a mode, not a page.** A builder on its own screen is a builder
    whose result you cannot see; the reading view *is* the editing view with
    the controls turned on, so a resize is judged against the widgets beside it
  - **One drag saves the whole layout.** Moving a widget reflows the ones
    around it, and one request per card lets a reader reload mid-flight and
    find a layout that never existed (§73)
  - **Every gesture is also a control** (§54): move, widen, narrow, taller and
    shorter are menu items, so a grid that can be dragged can also be
    rearranged from a keyboard — and the scroll inside a widget holds focus,
    because a scrollable region a keyboard cannot reach has no bottom half
- [x] Widget kinds: KPI, gauge, line/area/bar/pie chart, heatmap, table, list,
      activity feed and alerts — each configured with an entity, a grouping, a
      period and its own filters
  - **A widget names a question; it does not copy one.** The service stores
    geometry and configuration and computes *nothing*: a KPI is answered by
    `/api/explorer/insights`, a chart by `/api/analysis/run`, a list by
    `/api/explorer/query`, the alerts and the feed by `/api/dashboard/*`. Every
    one of those is already declared, already aggregated in PostgreSQL and
    already permission-checked — and a dashboard that recomputed any of them
    would be a second answer to a question the platform already answers
  - **A widget with no grouping is complete, not broken.** The dataset declares
    which field is worth grouping by; a chart widget that names none takes that
    default, read from the catalogue rather than invented in the page
  - **A widget that cannot be answered says so in place** (§34, §76) — which
    dataset, which permission, and the correlation id. A dashboard is read at a
    glance, and a panel that fails quietly is a number somebody will quote
  - A grid that would render on top of itself is refused on write, not clamped
    on read: a card silently narrowed on save is a layout the reader did not
    choose and cannot undo
- [x] **Sharing reuses `resource_shares`, exactly as saved searches do**:
      private by default · shared with named members · public; only the owner
      edits, re-shares or deletes
  - `core/sharing` holds the visibility predicate, the owner check, the member
    replacement and the scope vocabulary. Saved searches, reports and now
    dashboards all read it, and adopting it cost one string — which was the
    whole claim. Saved views (§46) are the remaining adopter
- [x] One dashboard is the reader's home page (§67)
  - One at a time, cleared in the same transaction: two homes is a preference
    that cannot be honoured
  - **`is_home` is published as *this reader's* home, not the owner's.** The
    column records a preference belonging to whoever owns the dashboard, and
    publishing it raw put a home marker on a colleague's public dashboard —
    telling the reader something false about their own settings. Found by an
    e2e test counting the markers in the list
- [x] Auto-arrange, and widgets drawn from what the reader already saved
  - **`react-grid-layout`, following QSINT** — drag a card to a place, drag its
    corner to a size, and have the gap it left close behind it. The third is
    the one that matters: a grid that lets a reader leave a hole fills up with
    holes. Committed on `onDragStop` and `onResizeStop`, not on every frame of
    a drag — forty writes and a server deciding what a half-finished gesture
    means
  - **The pointer is not the only way.** `react-grid-layout` is pointer-only by
    construction, so every gesture is also a menu item on the card. Both write
    the whole layout through one endpoint, so neither is a second answer to
    "where is this widget" (§54)
  - **"Tidy up"** applies the same vertical compaction on demand, in reading
    order, and settles — tidying twice gives the same answer, which is what
    makes it a button rather than a surprise. Six unit tests, because the cases
    that matter are a hole above a widget, two widgets competing for one row,
    and one wider than the grid
  - **Two kinds put something the reader already made on the grid**: `REPORT`
    draws a saved report — the chart builder's own output, which is what closes
    "a saved chart becomes a dashboard widget without being rebuilt" — and
    `SEARCH` answers a saved search through the explorer query. Both inherit
    the sharing, the audit trail and the permissions of the thing they name
    rather than copying its definition
  - The reference is *parsed*, not resolved, on write: whether the reader may
    see that report is decided when the widget is drawn, by the endpoint that
    owns it. A check at save time would go stale the moment its owner changed
    the audience

### `/announcements` — system messages (§17)

- [ ] Platform-wide announcements: scheduled banners for maintenance and
      releases, targeted by role, organization or user
- [ ] Acknowledged per reader, so a notice can require a response
- [ ] Shown in the shell as a dismissible banner, and listed on the page

### `/maps` — records on a map (§44, §61)

- [x] Customers, devices, orders, tickets and projects as markers on the cities
      they are in; choropleth by country for the same measure, and both levels
      added up again by region
  - **Two layers, because place has two levels.** A shaded Germany does not say
    whether that is Munich or Berlin; a scatter of dots does not say that
    Germany is twice France. One picture carries both
  - **Coordinates come from a gazetteer, not from a column.** Nothing in the
    schema has a latitude, and adding one would mean a migration and a backfill
    to store a fact that has not changed since the city was founded. The join
    is `customers.city = "Amsterdam"`, at query time, against the thirty cities
    the platform's data uses (`core/geography.py`). The **seed picks from that
    same list**, so a city that can be generated is a city that can be placed
  - **This is not the analysis compiler, deliberately.** A place is almost
    always one join away — an order is drawn at its *customer's* city — and the
    compiler groups a single table on purpose. `services/maps.py` is the one
    shape of question it cannot express, and keeps its habits: aggregated in
    PostgreSQL, everything declared, gated by the dataset's own permission
  - **What cannot be placed is on the screen, not in the gap.** "60 orders, 4
    of which we cannot place" is the honest sentence; a map that draws 56 dots
    and says nothing answers a different question from the list beside it
- [x] Clicking a region or cluster drills into the filtered list (§44)
  - Where the data actually is: customers and devices carry their own place, so
    a click filters their own list. Orders, tickets and projects borrow their
    customer's city, so a click opens the customers there — and the panel says
    so rather than pretending the order list can be filtered by a column it
    does not have
  - The list is filtered by what the *records* call a country, not by what the
    map does. They differ ("United States" against "United States of America"),
    and a mismatch is the one failure a choropleth cannot survive because it
    looks exactly like a country with no customers. The difference is declared
    in `core/geography.py:MAP_NAMES` and asserted by a test
- [x] Shares the period and filter controls the dashboard uses
  - The analysis vocabulary, so "last 90 days" means one thing across the whole
    ANALYSE section. Dataset, measure and period all live in the URL (§69, §72)
- [x] **The basemap is vendored, not fetched** — 177 country outlines at
      1:110 000 000, 53 KB gzipped, inside the map route's lazy chunk. The
      stack runs offline behind `docker compose up`, and a map that is blank
      without a CDN is blank in exactly the environment this template exists to
      demonstrate. `scripts/vendor-world-map.py` regenerates it and documents
      the provenance
  - Natural Earth stores Russia, Fiji and Antarctica as single rings running
    past ±180°, assuming whatever draws them applies a projection that knows
    about the seam. ECharts maps longitude to x linearly, so the first version
    of this asset drew two horizontal lines straight across the world. The
    script splits those rings at the meridian and closes each half, which is
    what a projection would have done
- [ ] Markers do not cluster yet: at thirty cities there is nothing to cluster,
      and a clustering rule tuned against thirty points is a rule that will be
      wrong at three thousand

### `/workflows` — condition → action automation (§49)

- [x] Built on the **same RAQB tree** the advanced search produces, so one
      editor and one compiler serve both — the same `e2e/query.ts` helpers
      drive both screens, so it is asserted and not merely intended
- [x] Actions: notify · email · raise a task · call a webhook — declared beside
      the functions that execute them, and published for the editor to render
- [x] Schedule and cooldown, so one breach does not send forty messages. The
      cooldown is **per record**, which is what makes that sentence true; the
      schedule is stored and nothing runs it unattended yet (§23)
- [x] **Dry run** against current data before enabling — and a rule is created
      paused, with the wizard's last step being the rehearsal
  - **Acceptance met**: the rule that fires is provably the rule the inspector
    showed, because `describe_tree` renders what `compile_tree` compiles and
    the page shows the server's rendering rather than one of its own

### `/reports/builder` and `/charts/builder` (§28, §44)

- [x] Report builder: pick an entity, then its dimensions, metrics, filters,
      grouping and period; preview server-side as you build; save, share,
      schedule, export
  - Shipped. The preview *is* the query that gets saved, and what may be
    picked comes from `/api/analysis/catalog` — so the builder cannot offer a
    column the compiler will reject. Scheduling stores its cron string;
    running one on a schedule waits on §23
- [x] Chart builder: every ECharts type the platform themes — line, area,
      bar, horizontal and stacked bars, multi-line, pie, treemap, funnel,
      radar, heatmap, scatter and gauge — with a live preview in both themes
- [ ] A saved chart becomes a dashboard widget without being rebuilt — waits
      on `/dashboards` (§45), which does not exist yet. The *saving* half is
      done: a chart is a report, so whatever reads reports will read charts
  - **It is picture-first, which is the half the report builder is not.**
    That builder composes a question and then offers seven ways to draw it;
    somebody who wants a heatmap should not have to discover, after building a
    one-dimensional question, that heatmaps were never on the menu
  - **Every kind is offered, and the ones the question cannot feed are refused
    by name** (§76): "Heatmap — needs a second grouping", "Scatter — needs a
    second measure". What each kind needs is declared beside the renderer that
    needs it (`components/charts/shapes.ts`), never listed in the page — these
    are facts about what `heatmap()` and `scatter()` read
  - **The gallery is drawn from the reader's own numbers**, fourteen live
    thumbnails, stripped of every label because at 104px the words are noise
    and the shape is the answer
  - **A chart is a saved analysis, which is what a report already is.** No
    second table, no second sharing model, no second lifecycle: it saves
    through `reportsApi` with the chosen `visualization`, appears on
    `/reports`, and opens in either builder. The draft is one URL contract
    (`entities/analysisDraft.ts`) that the workspace and both builders share,
    so "open this in the report builder" is a navigation rather than a
    translation
  - Two renderer bugs this found and fixed: `panelFor` never set `x`/`y`, so a
    scatter built from an analysis drew every point at the origin; and the
    heatmap and scatter renderers had the *dashboard's own questions* baked
    into them — a weekday-by-hour calendar and a "Budget spent" axis. Both now
    take their axes from the panel, which is what makes them drawable from any
    two declared dimensions or measures
  - `multi-line` was themed by the renderer and refused by the store, so a
    saved analysis could not name a picture the platform draws. A test now
    asserts the two lists are one list
  - Verification: 311 backend tests, 266 frontend (16 new), 135 Playwright
    (5 new) — including that a thumbnail is a real canvas of the database's
    numbers, that a refused kind stays refused after a reload because the
    refusal is derived from the question, that a saved chart answers on
    `/reports`, that an operator is told which permission is missing, and that
    the page is axe-clean

### Dashboard, expanded (§2, §44)

- [x] KPI row with previous-period comparison and drill-down
- [x] Alert strip, activity feed, six chart panels, chart/table toggle, CSV
- [ ] **More chart types**, as gif_responder's dashboard does: stacked area,
      horizontal bars, a donut with a centre total, a day/hour heatmap, a
      funnel, a gauge for SLA compliance, and a scatter of value against age
  - **Acceptance**: every panel is readable in both themes, has an empty state,
    and can be read as a table and exported

---

## Entity pages — six datasets, six pages (§7, §8)

There used to be one generic list page rendered six times. It was correct,
DRY, and exactly wrong for a template: every entity looked like every other
one, so the project demonstrated *one* way to present records and implied
there was only one. The point of a template is the opposite.

- [x] **Six list pages, no shared layout**
  - `/tasks` — a **board**. Lanes are the declared status vocabulary, not the
    values on the page, so an empty lane is information and the columns do not
    move as work does. Each lane is its **own query**: it knows its own total
    from the server, pages independently, and a hundred blocked tasks cannot
    push "in review" off the screen. Grouping one downloaded page would report
    "3 in progress" for a project with ninety
  - `/projects` — a **portfolio timeline**. A project has a shape in time and a
    table of dates hides it; two bars overlapping in March is a fact about
    capacity that no sort reveals. Budget burn sits on the same row as reported
    health, because that is the pair that disagrees — "on track" at 96% of
    budget is the finding
  - `/customers` — an **account grid**. Who they are, what they are worth, how
    they feel, when anybody last spoke to them: four facts that read badly as
    four columns and well as one card, ordered by lifetime value because that
    is the order people ask for
  - `/orders` — a **ledger**. The densest table in the platform, tabular
    numerals, with payment and fulfilment as *separate* columns because an
    order can be paid and unshipped or shipped and unpaid, and collapsing that
    loses the only two facts anybody chases
  - `/tickets` — a **split triage queue** (§62, §63). The job is working down a
    list, not looking at one, and a page that costs a navigation per ticket
    costs it forty times an hour. The open ticket is in the URL
  - `/devices` — a **fleet monitor**. Two health signals per unit as bars
    rather than numbers, because a wall of forty is scanned and a scan reads
    length faster than digits. Staleness gets its own colour: a device that has
    not reported in a week is a different problem from one reporting that it is
    unwell
- [x] **What they share is the contract, not a template.** `useEntityView`
      holds the catalogue lookup, the URL keys, the filters, the query and the
      aggregates; `EntityChrome` holds the header, the facet bar and the metric
      strip. Neither has an opinion about layout — the moment either grows a
      `view` prop it has become the generic page these replaced
- [x] **`POST /api/explorer/insights` (§44, §71)** — headline metrics,
      breakdowns and a trend for whatever the current query selects
  - Declared on the `Resource` (`Insight`, `Metric`) like everything else, so
    adding a headline number to a dataset is a declaration rather than an
    endpoint and a page
  - Takes the **same payload** the query takes. A summary computed over the
    whole table while the list below shows a filtered slice is two answers to
    one question, with no way to tell which is which
  - Aggregated in PostgreSQL. Summing twenty-five loaded rows gives "revenue:
    41 000" for a dataset holding four million — not a smaller version of the
    right answer but a wrong one
  - A breakdown's long tail is **collapsed and named**, never dropped: a chart
    whose slices do not add up to the total cannot be reconciled with the list
    beside it
- [x] Tests assert the pages are *different*: a lane, a bar, a card, two
      settlement columns, a split queue, a gauge. The suite that came before
      asserted the same three things six times and would have passed against
      the page this work replaced

---

## Phase 0 — Foundations

- [x] Repo scaffold (`backend/`, `frontend/`, `docs/`)
- [x] QF framework wheel vendored into `backend/dist/`
- [x] `README.md` + `docs/logo.svg`
- [x] `backend/Dockerfile` — two stage, `CMD gunicorn -k gevent -c gunicorn.conf.py wsgi:application`
- [x] `frontend/Dockerfile` — Vite build, bundle served by nginx on the API's
      own origin (no CORS, no API URL compiled into the bundle)
  - Healthcheck targets `127.0.0.1`, matching the rendered IPv4 nginx listener
    instead of Alpine's IPv6-first `localhost`
- [x] `docker-compose.yml` — postgres 18, redis 8, keycloak, seed, api, frontend
  - **Acceptance**: `docker compose up` on a clean machine reaches a working
    sign-in page with seeded data and no manual step; every service has a
    healthcheck; the API waits for postgres and keycloak to be *healthy*, not
    merely started; a second `up` does not re-seed or duplicate data
- [x] `.env.example` — every knob documented, working local defaults
  - **Acceptance**: copying it to `.env` unchanged produces a working stack
- [x] `Makefile` — `up` · `down` · `clean` · `wait` · `urls` · `seed` · `reseed` ·
      `check-seed` · `sync-roles` · `psql` · `test` · `test-backend-db` · `e2e` ·
      `lint` · `logs`
  - `reseed` passes `SEED_ARGS` with `-e`, as `check-seed` already did. Setting
    it in the caller's environment does nothing: compose only forwards a
    variable a service declares, so `make reseed` was silently a no-op against
    a database that already had data — which is every database it would ever
    be aimed at
- [ ] `docs/architecture.md` — the request path, the auth flow across the two
      Keycloak URLs, the layering rule, why QF is wired the way it is
- [ ] `docs/features.md` — the §1–§77 catalogue mapped to routes and endpoints,
      as a developer's index into the template (§77)
- [x] `docs/RBAC.md` — JWT/Redis verification flow, exact default role/access
      matrix, additive groups, backend enforcement and frontend behavior

## Phase 1 — Backend core

- [x] `src/config.py` + top-level `config.py` shim (QF requires it)
- [x] `wsgi.py` / `main.py` / `gunicorn.conf.py`
- [x] `core/db.py` — engine, `session_scope`
- [x] `core/errors.py` — domain error taxonomy + Flask/RESTX handlers
- [x] `core/pagination.py` — page/size envelope + keyset cursor (§52)
- [x] `core/query.py` — declarative FieldSet filter/sort/search/facets (§71)
- [x] `core/rules.py` — RAQB tree → SQLAlchemy, and → readable text (§4, §51)
- [x] `core/cache.py` — Redis helpers, degrading to a miss when unreachable
- [x] `core/auth.py` — JWT verification, personas, RBAC decorators (§58, §76);
      verified claims cached in Redis under a SHA-256 token digest for no
      longer than the JWT's remaining lifetime, with cache failure degrading
      to normal signature verification
- [x] `core/audit.py` — audit trail writer (§21)
- [x] `core/correlation.py` — correlation id + CORS
- [x] API runtime — `maps/endpoint.json`, validated at startup
- [x] `core/export.py` — CSV / XLSX / JSON writers honouring filters, sort and
      columns (§30). Wired into Data Explorer and the audit ledger; every list
      built after this gets it by handing over the statement it already has
  - **It exports the question, not the page.** The same statement the list
    endpoint built, minus its LIMIT — so the file and the screen cannot
    disagree about what was asked
  - **It streams.** Rows come off the cursor in batches and go out as they
    arrive, so a worker holds a batch rather than a file. The generator opens
    its own session, because the response is returned before the first row is
    read and a handler's `session_scope` would already have closed — a
    truncated download with a 200 on it
  - **It does not hand Excel a formula.** A cell beginning `=`, `+`, `-` or `@`
    is *executed* on open, and those values came from a text box somebody typed
    into. Quoted on the way out; numbers left numeric so a number column stays
    one (§76)
  - A UTF-8 BOM, because Excel on Windows otherwise reads the file as the local
    codepage and mangles every accented name in it
  - Exporting is its own permission (`records.export`), separate from reading:
    taking a copy of the ledger off the platform is not the same act as looking
    at it
  - Still open: **selection** (export these twelve rows) waits on bulk
    selection, and the row cap becoming a background job waits on §23
- [ ] `core/importer.py` — column detection, mapping, row validation, staged
      preview, transactional execute (§29)

## Phase 2 — Data model

- [x] Identity: organizations, departments, teams, regions, users, roles,
      permissions, groups, sessions, login history, security events
- [x] Business: projects, customers, tickets, orders, tasks, documents,
      devices, calendar events
- [x] Content: emails/threads/attachments, comments, tags, files/folders
- [x] Platform: notifications, audit logs, system logs, jobs, scheduled tasks,
      feature flags, api clients, integrations, alert rules, email templates
- [x] Personalization: saved searches, saved views, favorites, recent items,
      dashboards/widgets, preferences, reports
- [ ] Alembic migrations, on the naming convention already in `models/base.py`
  - **Acceptance**: `alembic upgrade head` on an empty database produces exactly
    what `create_all` does, asserted by a diff test

## Phase 3 — Seeds (§57)

- [x] Deterministic generator: 20 orgs, 150 users, 50 projects, 500 tasks,
      1 000 audit rows, 200 emails, 100 files, 100 jobs, thousands of records —
      15 454 rows across 49 tables, `python -m src.seed`
- [x] Referential consistency across all modules — `--check` verifies it
- [x] The five Keycloak personas seeded with the realm's emails, so signing in
      adopts a populated profile instead of provisioning an empty one
- [ ] Data-quality seeding for §65 — deliberate duplicates, stale records and
      incomplete profiles, in known quantities the tests can assert

## Phase 4 — Backend API

Each endpoint ships with its five-case integration test and the page consuming it.

- [x] Health / readiness / dependency snapshot (§24)
- [x] Meta: SPA config, permission catalogue, roles, route surface
- [x] `/api/me` — profile, live permissions, organization and validated
      preference updates (§58)
  - **Acceptance**: drives every permission decision in the UI; a role change on
    the server is visible on the next request without re-login
- [ ] Dashboard: KPIs with previous-period comparison and sparklines, the
      thirteen chart types, alerts, drill-down (§2, §44, §66)
  - **Acceptance**: every KPI links to the list that explains it with the same
    filters applied; "this month" means the same thing to the tile and the chart
    beneath it; drill-down keeps a back-stack (§44)
- [~] Generic entity **read and write** ship for all six datasets (§3, §7, §8,
      §9). One declaration yields the list, its filters, facets, sort, search
      and export; `/api/records/<type>/<id>` adds the detail, the edit and the
      delete, and `POST /api/records/<type>` the create — all from the same
      declaration, so a field filterable on the list is a field the detail page
      shows and a field the form may write is one the API accepts. Bulk (§43)
      is next
  - The list endpoint is deliberately the explorer's `POST /api/explorer/query`
    rather than a second implementation. Two list endpoints is two places for
    "case-insensitive" to be decided differently
  - A record of the wrong type is a 404 rather than a redirect or the record:
    an id is not a capability, and whether it exists is itself information
  - Writes are declared, not inferred: `Writable` names the fields a form may
    touch and the bounds on them, `Identity` names the identifier the server
    generates. A dataset with neither is read-only and says so, rather than
    accepting a payload and quietly ignoring it
  - **Acceptance**: partly met. One declaration → list, detail, export, filters,
    facets, create, edit and delete, all in SQL and all audited. Bulk, and the
    per-row partial result it has to report, are open
- [ ] Bulk preview endpoint (§75) — affected count split into "selected
      manually" and "selected by filter", before anything is applied
- [~] Search: simple and advanced Data Explorer shipped; global and quick
      entity search remain (§4, §6, §31, §32)
  - **Acceptance**: the inspector's text and the executed SQL come from the same
    tree (§51); global search groups by entity type and is keyboard-navigable
- [~] Saved searches ship with private/shared/public backend enforcement and
      owner-only writes; saved views and remaining sharing UI are open
      (§5, §46)
- [ ] Admin: users, groups, roles, permissions, organizations, departments,
      settings, flags, API clients, integrations, jobs, scheduled tasks,
      email templates (§11–§13, §25–§27, §42)
- [~] **`/admin/audit` — audit explorer (§21).** Ledger, entry and per-record
      timeline ship. Filterable on actor, action, resource type/id, result,
      correlation id, impersonation and date range, all in SQL (§71) off the
      same `core/query.py` declaration that publishes the filter vocabulary.
      **Export ships** — CSV, JSON and XLSX of the filtered ledger, carrying
      the columns an investigation needs that a table has no room for
  - Read-only by construction: no create, update or delete endpoint exists, and
    an e2e test asserts that none answers. An audit trail with a `DELETE` is a
    trail whose missing entry proves nothing
  - The ledger needs `audit.view`; the per-record timeline needs only
    `records.view`, because reading one record's history is not the privilege
    of reading everything anybody has ever done. The timeline refuses to answer
    without a resource, so it cannot become the ledger by omission
  - **Acceptance**: met, and asserted rather than inspected — the row stays
    readable when its actor is gone (`actor_label` is denormalised); added,
    changed and cleared fields are three distinguishable kinds the *server*
    decides, so the drawer cannot re-derive a different diff; secret-shaped
    fields are redacted on the way **out** as well as in, so the property
    belongs to the endpoint rather than to every writer that will ever exist;
    an impersonated action records both identities
  - `AuditLog` gained `impersonator_id` / `impersonator_label`. A boolean alone
    said an impersonation happened and left unanswered the only question
    anybody asks of such a row
- [~] Notifications ship complete — list, counts, filters, server-side
      grouping, mark one/all/group, delete, and the live channel (§17).
      Notification *preferences* (§40) are still open
- [ ] Email module: threads, messages, drafts, templates, send (§14–§16)
- [ ] Tasks, calendar, files, comments, tags, activity (§18–§20, §35–§37, §48)
- [ ] Favorites, recents, dashboards, reports (§38, §39, §45, §67, §28)
- [~] Export ships for every list that exists (§30). Import (§29) and the
      "an export above the row limit becomes a background job" half are open
  - **Acceptance**: an export above the row limit becomes a background job with
    a downloadable artefact; an import previews per-row errors before executing
    and never half-applies a batch
- [ ] Alert rules evaluation (§49) — the same RAQB tree the search builder emits

## Phase 5 — Frontend foundation

- [x] Vite + React + TS + AntD + ECharts + RAQB + cmdk toolchain — dev server
      ready in 79ms; `build` and `typecheck` clean under `strict: true`;
      vendor split by module path (react 46KB gz, antd 235KB gz, app 6KB gz)
- [x] Theme: `tokens.ts` → AntD theme → CSS variables → ECharts theme; light /
      dark / system; three density modes; both persisted and applied to the
      document root
- [~] API client — correlation id on every request, `ApiError` from the error
      envelope, cancellation, bearer injection, 12 unit tests. Still hand-written;
      generating it from `/swagger.json` is outstanding
- [x] Auth: Keycloak OIDC using the coordinates `/meta/app` publishes, silent
      refresh, permission hook reading `/api/me`
  - **Acceptance**: no Keycloak URL is baked into the bundle at build time
- [~] URL-state persistence — Data Explorer persists resource, simple/faceted/
      advanced filters, sort, page, page size, columns, result mode and selected
      saved search; density and scroll restoration remain
      position, selected view (§69, §72)
  - **Acceptance**: copying the URL reproduces the exact view for another user
    with the same permissions; opening a record and returning restores the list
    exactly, scroll included; back/forward move through view states
- [~] App shell (§1): nested permission-aware navigation, authenticated profile,
      403 deep-link guard, sign-out, the live notification bell and the
      sidebar unread badge shipped; global search, recents, favorites, help and
      app switcher remain
  - Navigation items name the counter they carry. Only `unread` has an endpoint
    today, and an item whose counter nothing publishes renders with no badge
    rather than a permanent `0`, which reads as a broken feature
  - [x] Header profile trigger uses a centered 40px button box, aligning avatar
        and name with the adjacent circular actions at every density; the
        header action row explicitly uses cross-axis centering rather than the
        inline baseline
- [x] **Command palette on `cmdk`** (as in gif_responder), `Ctrl/Cmd-K`, fuzzy,
      grouped: **On this page** · **General** · **Quick views** · **Settings**.
      Its trigger is in the **sidebar, under the logo, as "Fast actions"** — the
      palette is fast search *and* fast commands, not a link to `/search` (§31)
  - **Acceptance**: opens in under 50ms with the palette code-split; search is
    debounced and cancellable; arrows and `Enter` work throughout; every group
    reachable without a mouse; results respect the caller's permissions
- [~] Shared primitives: Data Explorer now contributes reusable server-backed
      result table/list/card renderers, facet controls, query builder, saved
      search drawer and debouncing hook; generic CRUD/bulk primitives,
      drawers and modals (§33), confirmation dialogs (§73), unsaved-changes
      guard (§74), bulk preview dialog (§75), timeline (§48), comments (§36),
      tag input (§37), auto-refresh control (§53)

## Phase 6 — Frontend pages

- [ ] Dashboard (§2, §66) + dashboard builder (§45, §67)
- [~] Entity lists ×6 (§7) and entity detail (§8) ship on **one** query
      contract and **six** layouts. The declarations the explorer and the query
      builder already read decide the fields, facets, sort, export and writable
      set; what a page does with them is its own. Adding a column to a resource
      still reaches every page with no frontend change
  - Three details have a shape of their own — a work page, a delivery review, a
    support console — and three read the declaration-driven page. The split is
    the point: a record people *act on* deserves a layout, a record people only
    read is better served by the catalogue
  - The list is not the Data Explorer, deliberately: the explorer is where a
    question is asked, this is where work is done — the entity's own columns,
    facets from the live counts, a row that opens the record, and a link to the
    explorer for when the question outgrows the page
  - Every detail page carries the audit timeline (§21, §48) on its History tab,
    reading the scoped endpoint so a reader who may open the record can read
    its history without the whole ledger
  - Forms (§9) ship as one declaration-driven drawer, opened from the detail
    page and from the board. The data table showcase (§3) and the wizard (§10)
    remain
- [~] Search: Data Explorer ships simple/faceted search, nested advanced RAQB,
      backend query inspector, saved searches and four URL-persistent result
      modes; saved views, highlighting, suggestions and preview remain (§4–§6, §51)
- [~] **Roles matrix `/admin/roles` (§13)** ships. The admin area itself (§11)
      remains
  - Built from the two things that actually decide access: the permission
    catalogue the code checks against, and the `roles` table
    `core/auth._permissions_for` reads on **every** request. So every
    permission an endpoint can require appears on the screen that grants it,
    one that does not exist cannot be granted, and an edit applies to the
    holder's next request with no re-login and no cache to invalidate
  - **Acceptance**: met, and proved rather than described — an e2e test signs
    a viewer in, has an administrator grant `audit.view` from the matrix, and
    asserts the *same session* may then read the ledger
  - Edits are staged and confirmed (§73). A permission change is not a
    preference: the reader sees the whole shape of what they are about to do
    before it happens, rather than firing six writes at the authorization
    model while thinking
  - You cannot remove your own `roles.manage` or `admin.access`. It is the one
    change that cannot be undone from inside the application, because the
    screen that would undo it is the one you just closed to yourself. Disabled
    in the UI and refused with a 409 by the server
  - Every edit is audited in the same transaction, with the permissions it
    moved visible in the audit drawer's diff
- [x] **People and impersonation `/admin/users` (§12)**
  - The directory filters, sorts and facets in SQL across the `roles` join, so
    "who are the seven administrators?" is one query and not a narrowed page
  - A person's **Access** tab is the answer to *why can they do that?* — the
    role's permissions, the groups' permissions, and the union the API actually
    enforces, with the group-granted half marked and its source named
  - **Impersonation** is a request header, not a second session:
    `X-Impersonate-User` is set on the client, resolved by `core/auth`, and
    every request made while it is set is audited under **both** identities.
    Starting one is itself audited, as the administrator, before the header
    goes on — so the ledger cannot be laundered by the act it records
  - Refused where it would be a privilege escalation or a lie: nobody may act
    as somebody of higher rank, as an account that is not `ACTIVE`, or as
    themselves. The button is shown and disabled with the reason rather than
    hidden (§76)
  - You cannot suspend or re-role yourself — the same self-lockout guard the
    matrix has, disabled in the UI and refused with a 409 by the server
  - **Acceptance**: met end to end — an e2e test impersonates a viewer, finds
    `/admin/roles` refused *by the API*, returns, and finds it allowed again
- [x] **Audit explorer `/admin/audit` + `AuditTimeline` component (§21)**
  - **Acceptance**: met. The table shows who / when / what at a glance, an
    entry opens its diff field by field with added and cleared distinguishable,
    every filter *and the open entry* round-trip through the URL so an
    investigation can be pasted into a ticket, and `AuditTimeline` is a
    standalone component fed by the scoped endpoint — ready for every entity
    detail page as those land
  - Its palette commands are the questions an auditor actually arrives with:
    refused actions, deletions, and anything done while impersonating
- [ ] Email inbox, detail, compose (§14–§16)
- [ ] Tasks kanban/table/list with drag (§18), calendar (§19), file manager (§20)
- [ ] System logs with live tail (§22), jobs (§23), health (§24), API (§25),
      integrations (§26), flags (§27), alert rules (§49)
- [~] Reports (§28) ship, with both builders and the map. The import wizard
      (§29) and the export *flows* — a request above the row limit becoming a
      background job (§30) — remain
- [ ] Component showcase (§60), page template gallery (§61), master/detail (§62),
      split view (§63), row preview drawer (§64), comparison (§47),
      data quality (§65), error pages (§34)
- [ ] Preferences (§40), security and sessions (§41), organization settings (§42)

## Phase 7 — Verification

- [x] `docker compose up` clean-boot green — every service healthy from empty
      volumes; seed wrote 15 554 rows and refused to run twice
- [x] Seed verified (row counts + referential checks)
- [~] Backend tests — 363 passing, including the comment thread's permissions
      and editing rules, the checklist's validation, saved reports' lifecycle and
      sharing, the analysis compiler's grouping,
      refusals and reconciliation, Data Explorer query, validation,
      record create/edit/delete with its declaration, bounds, foreign keys and
      lost-race refusal,
      JWT/RBAC, saved-search visibility/lifecycle, the notification centre's
      scoping/filtering/grouping contract, the audit ledger's permissions,
      diff semantics, redaction and read-only surface, the export writers' BOM,
      formula-injection and question-not-page guarantees, the entity detail
      contract, the connection map's aggregates, and the roles matrix's
      live-permission, lockout and audit behaviour
  - The one test that drops every table now does so in a scratch database of
    its own. Pointed at `TEST_DATABASE_URL` — which `make test-backend-db`
    aims at the **running stack** — it silently replaced the demo dataset with a
    small one, so every Playwright run afterwards measured 60 tasks where
    compose had produced 500. Nothing failed; the numbers were quietly different
- [~] Frontend unit + component tests — 295 passing, including the task work
      page and its conversation, saved reports
      and the builder, the analytics
      workspace, the record form,
      create/edit/delete on all six entity pages,
      the board write path and Data Explorer
      backend rendering, debounced search, saved-search module, the
      notification centre's six states, the header bell, the audit explorer,
      the per-record timeline, the authenticated download path, the generic
      entity list and detail pages, the connection map and the permission matrix
- [~] Playwright e2e suite — 149 tests green against `docker compose up` on the
      full seed, covering the shell, appearance, Data Explorer, saved searches,
      global search, relationships, the catalogue, the notification centre, the
      audit explorer, a real file download, all six entity lists, record
      writes — a card moved between lanes surviving a reload, an edit
      round-tripping through the server, a reader refused with the reason — and
      the permission matrix. A cold-boot run from empty volumes is still the
      outstanding proof
  - Worker count is **capped** rather than left to the machine. Playwright
    defaults to half the cores — sixteen browsers on a 32-core laptop —
    against one API container with two gevent workers and one Keycloak, and
    test parallelism that outruns the system under test produces flakes that
    read exactly like product bugs. Three consecutive clean full runs at the
    cap; `E2E_WORKERS` overrides it
  - Specs that write must not be readable by other specs' assertions: the
    roles tests append `PERMISSION_CHANGE` rows, so the audit tests now filter
    on seeded rows (`resource_type=ticket`) rather than on "every UPDATE"
  - Two flaky assertions found and removed rather than retried: a row read by
    position can be reordered by a background refetch before it is clicked, and
    an AntD option located by `.first()` finds rc-virtual-list's zero-width
    measurement copy
  - Three more, as the suite passed a hundred tests. Each was the test being
    wrong rather than the product:
    * **axe measured a drawer mid-animation.** A colour sampled during the
      transition is a blend of the text and what is behind it, which axe
      reports as a serious contrast failure on every element at once — for a
      frame no reader ever sees. The scan now waits for the document to stop
      animating, and the two *real* contrast failures it had been masking are
      fixed
    * **A date-format assertion read the newest audit row.** The ledger renders
      anything younger than a week as "3d ago", and the newest row is now
      usually something the suite itself just wrote. It reads the entry
      drawer, which always prints the full instant
    * **The worker cap is three, not four.** The failures at four were
      sign-ins timing out against Keycloak rather than anything in the
      product, and a suite whose failures are about its own concurrency
      teaches people to rerun instead of to read. Three consecutive full runs
      at the new cap; one flake in four before it
- [x] Frontend typecheck + production build
- [ ] Accessibility — axe clean on every route (§55)
- [ ] Performance — list page interactive under 1.5s against the seeded database
- [ ] **§77 walkthrough**: a developer who has never seen the repo opens it and
      finds a working example of each of dashboards, data tables, search,
      advanced filtering, entity management, administration, reporting, email,
      task management, monitoring, file management, notifications, security
      settings, audit logs, background jobs, multi-step forms, master/detail
      and reusable components — and the whole thing reads as one application
      rather than a gallery of disconnected demos
- [ ] Docs complete (`README.md`, `architecture.md`, `features.md`, this file)
