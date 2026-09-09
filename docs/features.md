# Features — the §1–§77 catalogue

Every section of the specification, where a reader finds it in the running
application, which endpoints answer it, and what state it is in.

**This document is generated.** The catalogue lives in
[`scripts/render-features.py`](../scripts/render-features.py) and both this
table and the one in [`TODO.md`](TODO.md) are rendered from it, so the two
cannot drift — there is no second copy to go stale.

It is also *checked*. `make lint` fails when a section marked shipped names a
page the router does not serve or an endpoint the map does not mount. The
hand-typed version of this table could not do that, and it showed: features
that had shipped months earlier were still marked open, and `/showcase/table`
sat in it as §3's home for the life of the project without ever being built.

Sections that are still open may name a route that does not exist — that is
what open means. Pattern notation (`/{entity}`, `/errors/*`, `:id`) is exempt
either way, because a catalogue has to be able to say "every entity list".

`—` means the section is a cross-cutting rule rather than a page.

<!-- generated:feature-matrix -->

| § | Feature | Route / where | API | State |
| --- | --- | --- | --- | --- |
| 1 | Application shell, navigation | all | `/meta/*`, `/api/me` | [x] |
| 2 | Overview dashboard, KPIs, charts | `/`, `/analytics` | `/dashboard/*`, `/api/analysis/*` | [x] |
| 3 | Advanced data table | every list | generic list | [~] |
| 4 | Advanced search (simple + RAQB) | `/explore` | `/api/explorer/query` | [x] |
| 5 | Saved searches | `/explore` (panel) | `/api/saved-searches` | [x] |
| 6 | Search results page | `/search` | `/api/search/global` | [x] |
| 7 | Entity list pages | `/{entity}` | generic list | [x] |
| 8 | Entity detail pages | `/{entity}/:id` | `/api/records/…` | [x] |
| 9 | Create / edit / delete | every list and detail | `/api/records/…` | [x] |
| 10 | Multi-step wizard | `/import`, `/dashboards`, `/showcase/templates` | `/imports`, `/api/dashboards` | [x] |
| 11 | User administration | `/admin/users` | `/admin/users` | [x] |
| 12 | Roles and permissions | `/admin/roles` | `/admin/roles` | [x] |
| 13 | System settings | `/admin/settings` | `/admin/settings` | [x] |
| 14 | Groups and teams | `/admin/groups` | `/admin/groups` | [x] |
| 15 | Mail and threads | `/mail` | `/api/mail/threads/:id` | [x] |
| 16 | Files and folders | `/files` | `/api/files` | [x] |
| 17 | Notifications and announcements | `/notifications`, `/announcements` | `/notifications`, `/api/announcements` | [x] |
| 18 | Tasks / work queue (kanban) | `/tasks`, `/kanban` | `/api/kanban/*` | [~] |
| 19 | Calendar | `/calendar` | `/api/calendar/*` | [x] |
| 20 | Object storage | `/files` | `/api/files/*` | [x] |
| 21 | Audit explorer | `/admin/audit` | `/admin/audit` | [x] |
| 22 | System logs, live tail | `/admin/logs` | `/admin/logs` | [x] |
| 23 | Background jobs | `/admin/jobs` | `/admin/jobs` | [x] |
| 24 | System health | `/admin/health` | `/health/*` | [x] |
| 25 | API clients | `/admin/api` | `/admin/api-clients` | [x] |
| 26 | Integrations | `/admin/integrations` | `/admin/integrations` | [x] |
| 27 | Feature flags | `/admin/flags` | `/admin/flags` | [x] |
| 28 | Reports and analysis | `/reports`, `/reports/builder` | `/api/analysis/*` | [x] |
| 29 | Import wizard | `/import` | `/imports` | [x] |
| 30 | Export | every list, `/exports` | `/exports` | [x] |
| 31 | Command palette (`cmdk`) | global | `/api/search/global` | [x] |
| 32 | Global search | header + `/find/global` | `/api/search/global` | [x] |
| 33 | Drawers and modals | — | — | [x] |
| 34 | Error and empty states | `/errors/*` | — | [x] |
| 35 | Activity feed | `/activity`, `/profile` | `/api/activity` | [x] |
| 36 | Comments | `/tasks/:id`, `/tickets/:id`, `/customers/:id` | `/api/comments` | [x] |
| 37 | Tags and labels | `/admin/tags` | `/tags` | [x] |
| 38 | Favorites | `/favorites` | `/favorites` | [x] |
| 39 | Recent items | `/favorites` | `/recents` | [x] |
| 40 | Personal preferences | `/settings/preferences`, `/profile` | `/api/me` | [x] |
| 41 | Security settings, sessions | `/settings/security` | `/security/*` | [x] |
| 42 | Organization settings | `/admin/organizations` | `/admin/organizations` | [x] |
| 43 | Bulk operations | every list that is a table | `/api/records/{type}/bulk` | [x] |
| 44 | Drill-down | dashboard, analytics, `/admin/quality` → list | `/api/analysis/run` | [~] |
| 45 | Dashboard builder | `/dashboards` | `/api/dashboards` | [x] |
| 46 | Saved views | every entity list, `/explore` | `/api/saved-searches` | [x] |
| 47 | Data comparison | `/compare` | `/api/records/{type}/compare` | [x] |
| 48 | Timeline view | detail tabs | `/admin/audit` | [~] |
| 49 | Alerts and rules | `/workflows` | `/api/automations/rules` | [x] |
| 50 | Data relationships | detail tabs + `/find/relationships` | `/api/relationships/*` | [x] |
| 51 | Query inspector | `/explore` | — (`core/rules.py`) | [x] |
| 52 | Pagination patterns | various | — (`core/pagination.py`) | [x] |
| 53 | Data refresh, auto-refresh | data-heavy pages | — (`src/api/websocket.py`) | [x] |
| 54 | Keyboard navigation | global | — | [x] |
| 55 | Accessibility | global | — | [x] |
| 56 | Responsive behaviour | global | — | [x] |
| 57 | Realistic demo data | — | `src/seed/` | [x] |
| 58 | Demo roles / personas | — | — (`core/auth.py`) | [x] |
| 59 | UX quality bar | global | — | [~] |
| 60 | Component showcase | `/showcase/components` | — | [x] |
| 61 | Page template gallery | `/showcase/templates` | — | [x] |
| 62 | Master / detail layout | `/mail`, `/tickets`, `/explore` | — | [~] |
| 63 | Split view | `/mail`, `/tickets`, `/explore` | — | [x] |
| 64 | Table row preview drawer | `/explore` | `/api/records/…` | [~] |
| 65 | Data quality indicators | lists + `/admin/quality` | `/admin/quality` | [x] |
| 66 | Dashboard alerts | `/` | `/dashboard/alerts` | [x] |
| 67 | Customisable home page | `/dashboards` | `/api/dashboards` | [x] |
| 68 | Navigation history | `/favorites` | `/recents` | [x] |
| 69 | Deep linking | global | — | [x] |
| 70 | Search within table data | every list | generic list | [x] |
| 71 | Server-side data model | — | — (`core/query.py`) | [x] |
| 72 | Query state persistence | global | — | [x] |
| 73 | Optimistic vs confirmed actions | board, forms | — | [~] |
| 74 | Unsaved changes protection | every drawer | — | [x] |
| 75 | Preview before bulk execution | every bulk action | `/api/records/{type}/bulk/preview` | [x] |
| 76 | Security-conscious UX | global | — (`core/auth.py`) | [x] |
| 77 | Final goal — coherent template | everything | — | [~] |

*68 shipped · 9 partly there · 0 not built — generated from `scripts/render-features.py`, which also fails if a shipped section names a route the router does not serve or an endpoint the map does not mount.*

### What is not finished, and what is missing from it

Every section above that is not shipped, with the part that is open. A catalogue that grades something "partly there" and stops has told a reader that something is missing and not what.

**§3 Advanced data table** — Partly there. Filtering, sorting, paging, facets and column choice all happen in PostgreSQL on every list, off one `FieldSet` declaration. What is open is the *showcase* of the table on its own, which `/showcase/components` does not yet include.

**§18 Tasks / work queue (kanban)** — Partly there. Boards, lanes and cards with full CRUD, server-side filters, drag between lanes reconciled against the server, and a keyboard equivalent of the drag. Ordering *within* a lane and the comment and checklist counts on a card's face are open.

**§44 Drill-down** — Partly there. Every KPI tile, chart segment and quality finding opens the rows behind it with the same filters applied. The back-stack that would return a reader to the picture they came from is open.

**§48 Timeline view** — Partly there. Every record page carries its own history, read from the audit ledger so the two cannot disagree. A cross-record timeline — one thread through several records — is open.

**§59 UX quality bar** — Partly there. The standing bar rather than a deliverable: it is met on every page that has shipped and is re-argued on every page that ships next.

**§62 Master / detail layout** — Partly there. The layout ships on three pages and the gallery documents when to reach for it. A dedicated showcase of the shape on its own is open.

**§64 Table row preview drawer** — Partly there. The explorer opens a row without leaving the list, deep-linked and keyboard-driven. The other lists send a reader to the record page instead, which for a ledger or a fleet is the better answer — the open part is the lists where it is not.

**§73 Optimistic vs confirmed actions** — Partly there. A dragged card moves at once and is reconciled against the server's answer, and a stale edit is refused with a 409 naming both moments. Forms are all confirmed rather than optimistic, which is the right default and leaves the optimistic half unexercised outside the board.

**§77 Final goal — coherent template** — Partly there. Open while anything above is, by construction: the section is the conjunction of the rest.

<!-- /generated:feature-matrix -->

## Why there is no saved-views table (§46)

A saved *view* is a saved *search*. There is one store for "how I look at this
list", not two.

The model layer used to carry both: `saved_searches` for the question and
`saved_views` for the presentation — filters, columns, order, grouping,
density — on the theory that "a search is a question, a view is how the answer
is laid out". Building §46 on the six entity lists showed the theory does not
apply here:

- `SavedSearch` already stores the presentation beside the question — columns,
  sort, order, page size, view mode — for the reason its own docstring gives:
  a saved search that finds the right rows and then shows the wrong columns is
  a saved search nobody trusts.
- The entity lists **fix their own columns** by design (§7). A ledger, a triage
  queue and a fleet monitor are not one table with different columns, so
  per-view column widths and pinning have nothing to configure.
- Density and page size are the reader's **preferences** (§40) and follow them
  across every list and every browser. A per-view copy would fight them.

What was left of `saved_views` was a second table answering the same question
with no rule about which one wins — the defect this template keeps finding
elsewhere (two stores for one fact: `is_favorite`, the `tags` array,
department headcounts). So the model is gone, the entity lists serve §46 from
the saved-search store, and `is_default` on a saved search is what a list opens
with — at most one per person per dataset, enforced on write.

An installation seeded before this may still have the `saved_views` table.
Nothing reads or writes it; a migration can drop it.
