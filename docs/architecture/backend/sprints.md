# Sprints: a backlog, time boxes drawn from it, and how they went (§18)

Sprints: a backlog, time boxes drawn from it, and how they went (§18).

The shape is Jira's and Taiga's, on the platform's one work queue:

* **The backlog** is every open task in no sprint, in a hand-made order
  (`tasks.backlog_rank`, sparse and fractional like the board's — a drop writes
  one row).
* **A sprint** takes tasks from it. Planning is dragging: a task dropped into a
  sprint gets its `sprint_id`, and one dropped back loses it. Adding work to a
  sprint that has started is allowed and remembered (`sprint_added_at`), so the
  report can tell what was committed from what crept in.
* **Starting** freezes the commitment; **completing** freezes what was done and
  carries everything unfinished to the backlog, the next planned sprint, or a
  new one. Both numbers feed the velocity chart.
* **The burndown** reads one snapshot per day (`sprint_snapshots`), written by
  the scheduler and on every start/complete; today is always computed live.
