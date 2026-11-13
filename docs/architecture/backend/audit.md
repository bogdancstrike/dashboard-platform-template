# The audit explorer (§21): who did what, when, and what changed

The audit explorer (§21): who did what, when, and what changed.

Three things this answers, and they are deliberately three different reads:

* **The ledger** — a filtered, sorted, paged list of every recorded action,
  with facets so the filter menus are built from the data rather than from a
  hardcoded list that drifts.
* **One entry** — the field-level before → after diff, plus the request context
  (correlation id, address, agent) that makes a row investigable.
* **One record's timeline** — the same rows scoped to a single resource, which
  is what every entity detail page shows (§48).

The list is built on `core/query.py` for the same reason every other list is:
one declaration drives the SQL, the sort, the facets *and* the filter
vocabulary the frontend renders, so a filter the UI offers is by construction a
filter the backend honours.

Read-only by design. There is no create, no update and no delete here — an
audit trail somebody can edit is not an audit trail, and the only writer is
`core/audit.record`, which appends in the same transaction as the change it
describes.
