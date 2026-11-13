# Extension points instead of upward imports — `core/events.py`, `services/wiring.py`

**Status:** adopted (backend refactor, 2026-11).

## Context
Several low-level services had to call features that sit above them: a record
write had to start the SLA clock, run automations and let an approval rule hold
the edit; the notification poll had to count pending approvals and unread chat;
the approvals inbox had to know every kind of approval; the analytics scheduler
had to run the health and anomaly jobs. Each of those calls was a
function-level import, hiding an 8-module and a 3-module import cycle
(`approvals ↔ approval_kinds ↔ automation_graph ↔ notifications ↔ record_writes ↔
sla ↔ timekeeping ↔ workflows`, `analytics_jobs ↔ customer_health ↔
metric_watches`) plus `core.auth ↔ core.api_keys`.

## Decision
* The lower module **declares** an extension point — a `core.events.Hook` or a
  registry — and calls it:
  * `record_writes.update_requested` (first answer holds the edit for approval),
    `record_writes.derived` (inside the write: the SLA clock),
    `record_writes.written` (after the audit row: automations);
  * `notifications.badges` (extra menu badges on the summary poll);
  * `approvals.register(Provider)` (kinds of approval);
  * `analytics_jobs.runner(code)` (scheduled analytics jobs).
* The feature **connects** from its own module (`@record_writes.written.connect`),
  so the import points from the feature to the mechanism, never back.
* `src/services/wiring.py` is the composition root listing every module that
  connects to something; `src/services/__init__.py` imports it, so the API, the
  seed and every test get identical wiring without an extra call.
* `api_keys` moved into the `core.auth` package; `caller` imports it, and it
  imports `auth.users`/`auth.principal` — a tree, not a loop.

## Consequences
No import cycle remains even counting function-level imports (checked by
`tests/test_layering.py`). A new subscriber must be added to `wiring.py`; the
wiring test asserts the built-in ones are connected.
