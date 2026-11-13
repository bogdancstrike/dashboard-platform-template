# The UI spec an insight is drawn from, and the data bound into it (§43)

The UI spec an insight is drawn from, and the data bound into it (§43).

An insight is a small page composed **only** from a fixed registry of general
components — a KPI tile, bar / line / area / pie charts, a table, a list,
Markdown text, a callout, a progress bar, a comparison and a timeline, plus a
section that groups them. The model (or a suggestion written by hand) chooses
and arranges them; it never writes markup or code, and it never puts numbers
in a chart itself.

Three steps, each its own function, because each has its own failure:

* **validate** — drop every node whose type is not in the registry, clamp
  every string, keep only the props a component reads. A bad node is removed
  and named in `warnings`; it never fails the insight.
* **bind** — a node that shows data carries a *query*, not data: an analysis
  (`services/analysis.run`: group, measure, period, filters) or a records
  query (`services/explorer.run`: columns, sort, filters). Each is executed as
  the *viewer*, with the viewer's permissions, read-only, and the result is
  inlined as `data`. A query that fails becomes that node's `error`, not the
  page's.
* **refresh** is binding again: the stored spec keeps its queries, so the
  numbers are re-read without asking the model anything.

The frontend renders the bound spec with the same registry and skips anything
it does not know — the contract is the same on both sides of the wire.
