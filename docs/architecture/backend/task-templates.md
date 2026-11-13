# Templates, recurring tasks, and the scheduler that makes the next one (§18, §23)

Templates, recurring tasks, and the scheduler that makes the next one (§18, §23).

**A template** is a task that has not happened yet: a title, a description, a
checklist, an estimate, points, labels and how long after creation it is due.
"New from template" creates a real task through the records API's own create —
named, validated and audited like one typed into the form — and "save as
template" goes the other way.

**A recurrence** is a rule set on a task: daily, weekly (on chosen weekdays),
monthly (on a day of the month) or every N days/weeks. When the rule comes due
the scheduler copies the task — fresh status, unticked checklist, the same
length between start and due — and moves the rule on to its next date.

**The scheduler** is two jobs in the platform's own jobs system
(`scheduled_tasks` + `background_jobs`): `work.recurring-tasks` and
`work.sprint-snapshots`. There is no worker process (see `core/background`),
so a run is started either by "Run now" (`POST /api/work/scheduler/run`) or,
lazily, by the first planning request after the job's `next_run_at` — spawned
off that request, recorded as a job like any other, visible at /admin/jobs.
