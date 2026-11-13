# `src/seed/planning`

Work planning demo data: sprints with history, epics, a timeline worth reading (§18).

Runs *after* the main graph is written, against the session, because it plans
work that already exists: it reads the seeded projects and tasks and gives a
handful of active projects the shape an agile team's would have — epics, story
points, four finished sprints and one running (with a burndown that has a
history), a ranked backlog, milestones and a chain of dependencies on the
timeline. Everything is dated relative to now.

Idempotent, so the same function is the `--sync-planning` repair for a
database seeded before planning existed: the structural part (epics, sprints,
templates, recurrences) is only added when no sprint exists yet, and the
fill-ins (start dates, lane ages, scheduled jobs) only touch what is empty.
