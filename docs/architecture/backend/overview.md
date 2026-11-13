# The overview dashboard

The overview dashboard (§2, §44, §66).

Three things come out of here, and they are deliberately computed together:

* **KPIs** with the same figure for the previous period beside them. A number
  with no comparison is a number nobody can act on — "312 open tickets" is only
  interesting once you know it was 289 last month.
* **Charts**, each carrying the rows it was drawn from, so the frontend can
  offer the same panel as a table without a second request (§30).
* **Alerts** — the operational exceptions worth interrupting somebody for, each
  with the link that leads to the records behind it (§66).

Every KPI names the list it drills into, with the filters already applied
(§44). A tile that shows a number and cannot tell you which rows it counted is
a tile that starts an investigation instead of ending one.

Aggregates run in PostgreSQL; the browser receives chart-sized results rather
than downloading whole datasets to count them. Snapshot panels explicitly say
so because their current state does not represent the selected historical range.
