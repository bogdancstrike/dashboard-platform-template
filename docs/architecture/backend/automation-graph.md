# The workflow graph engine

Automations as node graphs: the canvas's model, its validation, and the engine (§49).

The form editor wrote one sentence — *when records look like this, do these
things*. The canvas writes a small program: a trigger, conditions, if/else
branches, actions, delays and approvals, joined by edges. This module is that
program's one definition, and the one engine that runs it.

Five decisions carry the design.

**One stored definition, two editors.** The graph is what is stored and what
runs. The form editor reads and writes its straight-line case — trigger,
condition, actions in order — and `derive_legacy` projects every published
graph back onto the `alert_rules` columns, so the list, its filters and the
wizard keep working without knowing graphs exist. A graph that branches is
refused by the form editor rather than flattened: flattening would silently
throw away the branch somebody drew.

**The engine walks sets, not records.** A condition node is one `SELECT … WHERE
id IN (…) AND <predicate>` over every record that reached it, compiled by
`core/rules` exactly as the advanced search compiles it. So a scheduled run over
five hundred records is a handful of queries, and the condition a reader sees
on a node is provably the SQL that decided the path.

**A dry run is the same walk with the actions switched off** — the reason the
form editor's dry run was trustworthy, kept. The test run on the canvas is that
walk for one chosen record, reporting the path it took through every node.

**Draft and published are separate.** The canvas saves on every change; nothing
runs until somebody publishes, and every publish is kept whole as a version
that can be restored. A half-drawn workflow must never fire.

**Waiting is a row, not a sleeping thread.** A delay or an approval parks the
record in `automation_waits` with the version it was walking; the scheduler or
the approval decision resumes it from the right port of the right version.
