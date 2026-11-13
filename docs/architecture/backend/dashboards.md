# Dashboards

Dashboards: a layout of widgets, saved and shared (§45, §67).

What this service owns is deliberately small — *where the widgets are and what
question each one asks*. It computes no aggregates of its own. A KPI widget is
answered by `/api/explorer/insights`, a chart widget by `/api/analysis/run`, a
list by `/api/explorer/query`, the alert strip and the activity feed by
`/api/dashboard/*`. Every one of those is already declared, already aggregated
in PostgreSQL and already permission-checked, and a dashboard that recomputed
any of them would be a second answer to a question the platform has already
answered — wrong the first time the two drift.

So a widget is a *reference to a question*, not a copy of one. That is also
what makes "a saved chart becomes a dashboard widget without being rebuilt"
true rather than aspirational: the widget names the report, and running it
takes the stored definition through the same compiler the chart builder
previewed with.

Sharing is `core/sharing`, exactly as saved searches and reports use it —
private by default, shared with named members, public, and only the owner
writes. One mechanism for every saved thing is the point of that module.

Two rules the layout enforces, because a grid that does not is a grid that
eventually renders on top of itself:

* **A widget fits its dashboard.** `x + width` may not exceed the column
  count, and both are checked on write rather than clamped on read.
* **One home dashboard per person** (§67). Marking one clears the others, in
  the same transaction, because two homes is a preference that cannot be
  honoured.
