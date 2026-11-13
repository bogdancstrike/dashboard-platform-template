# Backend structure — packages, patterns, and the guards that keep them

**Status:** adopted (backend refactor, 2026-11). Guarded by `tests/test_structure.py`
(file sizes, import tree) and `tests/test_layering.py` (which layer may import which).

## Layers
`models` (schema) < `core` (mechanisms, no dataset knowledge) < `services` (rules,
no HTTP) < `api` (thin handlers). `src/bootstrap.py` assembles the process;
`seed` is a tool that may read everything. Imports form a tree — no cycle, not
even through an import inside a function.

## Domain packages (services and api share one map)
| package | holds |
|---|---|
| `records` | detail, writes, versions, bulk, compare, tags, relationships, search, favorites, saved searches, the explorer, contracts, customer health, quality, catalogue, maps |
| `transfer` | exports, imports |
| `analytics` | analysis, reports, report documents, dashboards (saved layouts), overview (the home dashboard), dashboard links, metric watches, jobs, `insights/` |
| `work` | kanban, task board, task planning, task templates, sprints, timeline, calendar |
| `decisions` | approvals, approval kinds, time tracking, SLA, forms |
| `automation` | workflow rules (`workflows/`) and the graph engine (`graph/`) |
| `collaboration` | chat, comments, wiki (`docs/`), mail, notifications, announcements, presence, live, activity |
| `knowledge` | files, collections (document Q&A), ingest |
| `ai` | usage guard, NL filters, assistant, brief, tools, page help |
| `people` | users, groups, organizations, roles, directory, profile, account, security |
| `platform` | settings, audit, system logs, jobs, health, integrations, API clients, developer portal, onboarding |

A service bigger than ~200 lines is a package: one module per responsibility
(`queries`, `commands`, `validation`, `serializers`, …), helpers below the
modules that use them, and a **lazy facade** `__init__` (`core/facade.lazy`)
so `from src.services.work import kanban; kanban.create_card(...)` keeps
working without the package importing all its submodules.

## Patterns
* **Repository helpers** — `core/repository.get_or_404 / found_or_404`.
* **Declarative validation** — `core/validation.Schema/Field` + `core/cleaners`
  (see `validation.md`).
* **Handler adapter** — `api/handler.endpoint` gives a handler a lazy `Call`
  (verb, query, body, caller, `run(service_fn, ...)`) behind QF's signature.
* **Observer hooks and registries** — `core/events.Hook`; `approvals.register`;
  `analytics.jobs.runner`; composition root `services/wiring.py` (see `events.md`).
* **Strategy tables** — workflow actions (`automation/workflows/registry.ACTIONS`),
  PDF block writers (`core/documents/pdf_blocks.WRITERS`), overview panels
  (`analytics/overview/chart_panels.PANELS`), explorer datasets
  (`records/explorer/datasets/<dataset>.py`).

## Testing a split package
Patch a name where it is *used*: `tests/patching.patch_package(monkeypatch,
package, name, value)` patches every submodule that binds it.

## Size rule
Source files ≤ 200 lines, test files ≤ 400. Permanent exceptions are data
tables; everything else over the limit sits in a shrink-only ratchet in
`tests/test_structure.py` (today: the seed, the model modules and a few core
modules).
