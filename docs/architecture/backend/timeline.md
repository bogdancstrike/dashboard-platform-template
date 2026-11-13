# The timeline: tasks as bars in time, with the dependencies between them (§18)

The timeline: tasks as bars in time, with the dependencies between them (§18).

A Gantt chart answers "what happens when, and what waits on what". It reads
the same `tasks` rows the board does — a bar is a task's `start_date` to its
`due_date` — and adds one table of its own, `task_dependencies`, which is
finish-to-start: the successor may begin the day after the predecessor ends,
plus a lag.

Three writes, each small and audited exactly as an edit of the same field
would be:

* **schedule** — a bar dragged or resized. The dates are written through
  `record_writes.apply_values`, and the answer says which dependencies the new
  dates break. Breaking one is allowed (a plan is a plan, not a proof); the
  reader is told, and offered `shift_dependants`, which moves every task
  downstream just far enough, keeping each one's length.
* **link** — a dependency drawn from one bar's end to another. A cycle is
  refused, because a plan in which A waits on B waits on A has no schedule.
* **unlink**.

The **critical path** is computed, not stored: the chain of linked tasks with
no slack, by the classic forward/backward pass over each linked component.
