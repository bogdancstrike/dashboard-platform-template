# `src/seed/workflows`

Workflow graphs for the canvas (§49): realistic, branching, with a run history.

Runs after the main graph is written. Three things, all idempotent so the same
function is the `--sync-workflows` repair for a database seeded before the
canvas existed:

* every automation gets its graph (a form-built rule becomes its straight line);
* a handful of canvas workflows a real operations team would draw — a branch on
  priority, a delay before a reminder, an approval before a discount, a webhook
  intake — added once each, by name;
* a fortnight of runs for each of them, with per-node counts, so the canvas's
  history overlay has something true to say the first time it is opened.
