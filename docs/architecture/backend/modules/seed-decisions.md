# `src/seed/decisions`

Seed data for Time & decisions: time, timesheets, approvals, SLA policies, forms.

Written against what the main seed already made — its people, tasks, tickets,
customers and reports — rather than as part of the in-memory `World`, because
every row here *refers* to that world and none of it is referred to by it.

Every part is idempotent and additive, so the same functions are both the seed
step and the `--sync-*` repairs for a database seeded before the feature:

    python -m src.seed --sync-approvals   # change rules and a queue of requests
    python -m src.seed --sync-time        # six weeks of time and timesheets
    python -m src.seed --sync-sla         # calendars and policies, applied to tickets
    python -m src.seed --sync-forms       # intake forms and their submissions

Dates are relative to now, so a database seeded today and opened in a month
still shows "last week" as last week.
