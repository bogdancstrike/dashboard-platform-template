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
| Endpoints | 33 of ~110 — health ×3, meta ×4, dashboard ×2, notifications ×4, current user ×1, explorer ×3, saved searches ×4, directory ×1, global search ×1, catalogue ×2, relationships ×2, audit ×5, records ×1 |
| Seed (`src/seed/`) | **done** — 15 454 rows, deterministic, `--check` verifies referential consistency |
| Tests | 192 backend + 129 frontend + 81 Playwright e2e — all green against `docker compose up` on the **full** seed (15 551 rows) |
| Frontend | shell, Data Explorer, discovery workspaces and the notification centre; live WebSocket channel with a polling fallback |
| Compose stack | **done** — `docker compose up` reaches a working stack; real Keycloak tokens verified |

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
- [ ] **Impersonation** (§12) — admin impersonates a viewer, sees the reduced
      UI, and both identities appear on the audit row
- [ ] **Command palette** (§31) — `Ctrl-K`, navigate to a record, run a page action
- [ ] **Audit explorer** (§21) — filter by actor and action, open an entry, read
      the before → after diff
- [ ] **Email** (§14–§16) — read a thread, reply, save a draft, send
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
| 2 | Overview dashboard, KPIs, charts | `/` | `/dashboard/*` | [ ] |
| 3 | Advanced data table | `/showcase/table` + every list | generic list | [ ] |
| 4 | Advanced search (simple + RAQB) | `/explore` | `/api/explorer/query` | [x] |
| 5 | Saved searches | `/explore` (panel) | `/api/saved-searches` | [x] |
| 6 | Search results, view modes | `/explore` | `/api/explorer/query` | [x] |
| 7 | Entity list pages | `/{entity}` ×6 | generic list | [x] |
| 8 | Entity detail page | `/{entity}/:id` | `/api/records/…` | [x] |
| 9 | Create / edit forms | `/{entity}/:id/edit` | generic CRUD | [ ] |
| 10 | Multi-step wizard | `/{entity}/new/wizard` | draft endpoints | [ ] |
| 11 | Admin area | `/admin` | `/admin/*` | [ ] |
| 12 | User management, impersonation | `/admin/users` | `/admin/users` | [ ] |
| 13 | Roles and permission matrix | `/admin/roles` | `/admin/roles` | [ ] |
| 14 | Email inbox | `/mail` | `/mail/threads` | [ ] |
| 15 | Email detail, threading | `/mail/:id` | `/mail/threads/:id` | [ ] |
| 16 | Compose email | `/mail/compose` | `/mail/messages` | [ ] |
| 17 | Notification centre | header + `/notifications` | `/notifications` | [x] |
| 18 | Tasks / work queue (kanban) | `/tasks` | `/tasks` | [ ] |
| 19 | Calendar | `/calendar` | `/calendar/events` | [ ] |
| 20 | File manager | `/files` | `/files` | [ ] |
| 21 | **Audit logs** | `/admin/audit` | `/admin/audit` | [x] |
| 22 | System logs | `/admin/logs` | `/admin/logs` | [ ] |
| 23 | Background jobs | `/admin/jobs` | `/admin/jobs` | [ ] |
| 24 | System health | `/admin/health` | `/health/status` | [x] API |
| 25 | API management | `/admin/api` | `/admin/api-clients` | [ ] |
| 26 | Integrations | `/admin/integrations` | `/admin/integrations` | [ ] |
| 27 | Feature flags | `/admin/flags` | `/admin/flags` | [ ] |
| 28 | Reports | `/reports` | `/reports` | [ ] |
| 29 | Import wizard | `/import` | `/imports` | [ ] |
| 30 | Export | every list | `/{list}/export` | [~] |
| 31 | Command palette (`cmdk`) | global | `/search/quick` | [ ] |
| 32 | Global search | header + `/find/global` | `/api/search/global` | [x] |
| 33 | Drawers and modals | — | — | [ ] |
| 34 | Error and empty states | `/errors/*` | — | [ ] |
| 35 | Activity feed | `/activity` + detail tabs | `/activity` | [ ] |
| 36 | Comments | detail tabs | `/comments` | [ ] |
| 37 | Tags and labels | `/admin/tags` + inline | `/tags` | [ ] |
| 38 | Favorites | `/favorites` | `/favorites` | [ ] |
| 39 | Recent items | sidebar + `/recent` | `/recent` | [ ] |
| 40 | Personal preferences | `/settings/preferences` | `/api/me/preferences` | [ ] |
| 41 | Security settings, sessions | `/settings/security` | `/api/me/sessions` | [ ] |
| 42 | Organization settings | `/settings/organization` | `/admin/organizations` | [ ] |
| 43 | Bulk operations | every list | `/{entity}/bulk` | [ ] |
| 44 | Drill-down | dashboard → list | — | [ ] |
| 45 | Dashboard builder | `/dashboards/:id/edit` | `/dashboards` | [ ] |
| 46 | Saved views | every list | `/saved-views` | [ ] |
| 47 | Data comparison | `/{entity}/compare` | generic list | [ ] |
| 48 | Timeline view | detail tabs | `/api/audit/timeline` | [~] |
| 49 | Alerts and rules | `/admin/alerts` | `/admin/alert-rules` | [ ] |
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
| 67 | Customisable home page | `/` | `/dashboards` | [ ] |
| 68 | Navigation history | global | `/recent` | [ ] |
| 69 | Deep linking | global | — | [ ] |
| 70 | Search within table data | every list | generic list | [ ] |
| 71 | Server-side data model | — | `core/query.py` | [x] core |
| 72 | Query state persistence | global | — | [ ] |
| 73 | Optimistic vs confirmed actions | global | — | [ ] |
| 74 | Unsaved changes protection | every form | — | [ ] |
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
- [ ] `/analytics` — cross-entity KPIs, trends, comparisons and drill-down with
      one shared period/filter context; analyses can become reports, charts or
      dashboard widgets
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
  - The graph is a deterministic radial layout in plain SVG. A force simulation
    would land somewhere different each time, making two screenshots of one
    record look like two different records; the list beside it is the
    accessible and complete equivalent
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
- [ ] **Drag a card between lanes and within a lane.** Optimistic on the client,
      reconciled against the server's answer (§73)
  - **Acceptance**: dragging a card and reloading shows it where it was
    dropped; a failed move snaps back and says why; two people dragging the
    same card do not corrupt the order
- [ ] Card detail: description, assignee, due date, labels, **to-do checklist**
      with per-item completion, **comments** with mentions, attachments,
      activity timeline
  - **Acceptance**: ticking a to-do updates the card's progress without a
    reload; the checklist and comment counts show on the card face
- [ ] Filters: assignee, label, due, text — applied server-side (§71)
- [ ] Keyboard: move a card between lanes without a mouse (§54, §55)

### `/notifications` — the notification centre, live (§17)

- [x] A page listing every notification: category, severity, actor, resource,
      timestamp, read state — with all six data states (§34), URL-backed
      filters (§69, §72) and its actions in the command palette's "On this
      page" group
- [x] **Mark one as read** and back again, **mark all as read**, mark one
      collapsed group read, and delete
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

### `/profile` — the user's own page (§40, §41)

- [ ] Header: avatar, name, role, organization, department, joined, last seen
- [ ] Tabs: overview · activity · security · preferences
- [ ] Personal analytics, in the style of gif_responder's profile: tasks
      completed over time, throughput by week, an activity heatmap by day,
      and the record types they touch most
- [ ] Their own recent activity, favourites, saved searches and sessions
- [ ] A public view of another user at `/profile/:username`, showing only what
      the viewer's permissions allow

### `/files` — object storage on MinIO (§20)

- [ ] MinIO added to the compose stack, with a bucket created on first boot
- [ ] Backend storage service behind one interface, so MinIO is swappable for
      S3 or a local volume without touching a handler
- [ ] **Presigned URLs** for upload and download — bytes never pass through the
      API process, which is what keeps a 200MB upload from occupying a gevent
      worker for the duration
- [ ] Multi-file drag-and-drop upload with per-file progress; move, rename,
      copy, delete; preview for images, PDF and text
  - **Acceptance**: uploading a file makes it appear in the folder without a
    reload; a download link expires; deleting a file removes the object as well
    as the row; a failed upload leaves neither

### Configurable dashboards, shared like saved searches (§45, §67)

- [ ] `/dashboards` — the reader's own dashboards, plus the ones shared with them
- [ ] Builder: add · remove · **resize** · **reorder** · configure widgets on a
      12-column grid; save and reset the layout
- [ ] Widget kinds: KPI, line/area/bar/pie chart, table, activity feed, alerts,
      my tasks, recent items — each configured with an entity, a metric, a
      period and its own filters
- [ ] **Sharing reuses `resource_shares`, exactly as saved searches do**:
      private by default · shared with named members · public; only the owner
      edits, re-shares or deletes; a member who wants their own duplicates it
  - **Acceptance**: one mechanism, one table, one set of rules for saved
    searches, saved views, reports and dashboards — a second sharing model is a
    second set of bugs
- [ ] One dashboard is the reader's home page (§67)

### `/announcements` — system messages (§17)

- [ ] Platform-wide announcements: scheduled banners for maintenance and
      releases, targeted by role, organization or user
- [ ] Acknowledged per reader, so a notice can require a response
- [ ] Shown in the shell as a dismissible banner, and listed on the page

### `/maps` — records on a map (§44, §61)

- [ ] Customers, devices and orders as clustered markers; choropleth by region
      for revenue, ticket volume and device health
- [ ] Clicking a region or cluster drills into the filtered list (§44)
- [ ] Shares the period and filter controls the dashboard uses

### `/workflows` — condition → action automation (§49)

- [ ] Built on the **same RAQB tree** the advanced search produces, so one
      editor and one compiler serve both
- [ ] Actions: notify · email · raise a task · call a webhook
- [ ] Schedule and cooldown, so one breach does not send forty messages
- [ ] **Dry run** against current data before enabling
  - **Acceptance**: the rule that fires is provably the rule the inspector
    showed, because both come from `core/rules.py`

### `/reports/builder` and `/charts/builder` (§28, §44)

- [ ] Report builder: pick an entity, then its dimensions, metrics, filters,
      grouping and period; preview server-side as you build; save, share,
      schedule, export
- [ ] Chart builder: every ECharts type the platform themes — line, area,
      stacked area, bar, stacked and horizontal bars, pie, donut, scatter,
      heatmap, funnel, gauge, timeline — with a live preview in both themes
- [ ] A saved chart becomes a dashboard widget without being rebuilt

### Dashboard, expanded (§2, §44)

- [x] KPI row with previous-period comparison and drill-down
- [x] Alert strip, activity feed, six chart panels, chart/table toggle, CSV
- [ ] **More chart types**, as gif_responder's dashboard does: stacked area,
      horizontal bars, a donut with a centre total, a day/hour heatmap, a
      funnel, a gauge for SLA compliance, and a scatter of value against age
  - **Acceptance**: every panel is readable in both themes, has an empty state,
    and can be read as a table and exported

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
      `check-seed` · `psql` · `test` · `test-backend-db` · `e2e` · `lint` · `logs`
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
- [~] Generic entity **read** ships for all six datasets (§3, §7, §8). One
      declaration already yields the list, its filters, facets, sort, search and
      export; `/api/records/<type>/<id>` adds the detail from the same
      declaration, so a field filterable on the list is a field the detail page
      shows. Create, update, delete and bulk (§9, §43) are next
  - The list endpoint is deliberately the explorer's `POST /api/explorer/query`
    rather than a second implementation. Two list endpoints is two places for
    "case-insensitive" to be decided differently
  - A record of the wrong type is a 404 rather than a redirect or the record:
    an id is not a capability, and whether it exists is itself information
  - **Acceptance**: partly met. One declaration → list, detail, export, filters
    and facets in SQL. Bulk, and the per-row partial result it has to report,
    are open
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
- [~] Entity lists ×6 (§7) and entity detail (§8) ship as **one** generic list
      page and **one** generic detail page, driven by the resource declarations
      the explorer and the query builder already read. Adding a column to a
      resource makes it appear on both with no frontend change
  - The list is not the Data Explorer, deliberately: the explorer is where a
    question is asked, this is where work is done — the entity's own columns,
    facets from the live counts, a row that opens the record, and a link to the
    explorer for when the question outgrows the page
  - Every detail page carries the audit timeline (§21, §48) on its History tab,
    reading the scoped endpoint so a reader who may open the record can read
    its history without the whole ledger
  - Data table showcase (§3), forms (§9) and the wizard (§10) remain
- [~] Search: Data Explorer ships simple/faceted search, nested advanced RAQB,
      backend query inspector, saved searches and four URL-persistent result
      modes; saved views, highlighting, suggestions and preview remain (§4–§6, §51)
- [ ] Admin area (§11), users with impersonation (§12), roles matrix (§13)
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
- [ ] Reports (§28), import wizard (§29), export flows (§30)
- [ ] Component showcase (§60), page template gallery (§61), master/detail (§62),
      split view (§63), row preview drawer (§64), comparison (§47),
      data quality (§65), error pages (§34)
- [ ] Preferences (§40), security and sessions (§41), organization settings (§42)

## Phase 7 — Verification

- [x] `docker compose up` clean-boot green — every service healthy from empty
      volumes; seed wrote 15 554 rows and refused to run twice
- [x] Seed verified (row counts + referential checks)
- [~] Backend tests — 192 passing, including Data Explorer query, validation,
      JWT/RBAC, saved-search visibility/lifecycle, the notification centre's
      scoping/filtering/grouping contract, the audit ledger's permissions,
      diff semantics, redaction and read-only surface, the export writers' BOM,
      formula-injection and question-not-page guarantees, the entity detail
      contract and the connection map's aggregates
  - The one test that drops every table now does so in a scratch database of
    its own. Pointed at `TEST_DATABASE_URL` — which `make test-backend-db`
    aims at the **running stack** — it silently replaced the demo dataset with a
    small one, so every Playwright run afterwards measured 60 tasks where
    compose had produced 500. Nothing failed; the numbers were quietly different
- [~] Frontend unit + component tests — 129 passing, including Data Explorer
      backend rendering, debounced search, saved-search module, the
      notification centre's six states, the header bell, the audit explorer,
      the per-record timeline, the authenticated download path, the generic
      entity list and detail pages, and the connection map
- [~] Playwright e2e suite — 81 tests green against `docker compose up` on the
      full seed, covering the shell, appearance, Data Explorer, saved searches,
      global search, relationships, the catalogue, the notification centre, the
      audit explorer, a real file download and all six entity lists. A cold-boot
      run from empty volumes is still the outstanding proof
  - Two flaky assertions found and removed rather than retried: a row read by
    position can be reordered by a background refetch before it is clicked, and
    an AntD option located by `.first()` finds rc-virtual-list's zero-width
    measurement copy
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
