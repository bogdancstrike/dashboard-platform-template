# `src/seed/__main__`

Seed command — `python -m src.seed`.

    python -m src.seed                    # create tables if needed, then seed
    python -m src.seed --scale small      # a tenth of the data, for iterating
    python -m src.seed --reset            # drop everything first
    python -m src.seed --check            # verify an existing dataset
    python -m src.seed --sync-schema      # add columns the model has and it lacks
    python -m src.seed --sync-files       # write the bytes seeded files point at
    python -m src.seed --sync-exports     # write the file every seeded export claims
    python -m src.seed --sync-imports     # make every seeded import run describe a real file
    python -m src.seed --sync-sessions    # one current session per person, and only a live one
    python -m src.seed --sync-favorites   # move the old per-row is_favorite flags into one store
    python -m src.seed --sync-tags        # make each record's tags array agree with its links
    python -m src.seed --sync-searches    # drop filter keys no dataset declares, add the list views
    python -m src.seed --sync-roles       # give built-in roles new permissions
    python -m src.seed --sync-reports     # make unrunnable saved reports runnable
    python -m src.seed --sync-automations # make unrunnable automations runnable
    python -m src.seed --sync-mailboxes  # give each demo persona an inbox worth opening
    python -m src.seed --sync-settings   # bring each setting's declaration up to date
    python -m src.seed --sync-jobs       # give every job status at least one job
    python -m src.seed --sync-org        # make each department's headcount agree with its people
    python -m src.seed --sync-health     # give every service a month of history to draw
    python -m src.seed --sync-flags      # create catalogue flags, reset untouched ones to default
    python -m src.seed --reset-flags     # every catalogue flag back to its seeded default
    python -m src.seed --sync-activity   # give each organization a feed it can filter
    python -m src.seed --sync-preferences # fill in preference keys an account predates
    python -m src.seed --sync-approvals  # change rules and a queue of approval requests
    python -m src.seed --sync-time       # six weeks of time entries and timesheets
    python -m src.seed --sync-sla        # business calendars and SLA policies, applied to tickets
    python -m src.seed --sync-forms      # intake forms and their submissions
    python -m src.seed --sync-collab      # chat channels, a wiki and meeting notes, if missing
    python -m src.seed --sync-assistant   # add the seeded assistant conversations that are missing
    python -m src.seed --sync-knowledge  # add the seeded document collections that are missing
    python -m src.seed --sync-dashboards # reset dashboard/widget periods the analysis engine cannot read
    python -m src.seed --sync-report-documents # weekly/monthly report documents for the Report builder
    python -m src.seed --sync-folders    # rename sibling folders that share a name
    python -m src.seed --sync-insights   # add the seeded insights (and the dashboard widget) that are missing
    python -m src.seed --sync-planning   # sprints, epics, a timeline and templates for the work queue
    python -m src.seed --sync-analytics  # customer health, contracts, version histories, alerts, public links
    python -m src.seed --sync-workflows  # a graph for every automation, demo canvas workflows and their runs
    python -m src.seed --sync-developers  # real API examples and two weeks of API usage (§31)
    python -m src.seed --sync-onboarding  # onboarding checklists in progress (§38)
    python -m src.seed --dry-run          # build in memory, write nothing

It refuses to seed a database that already has data unless `--reset` or
`--force` is given: the compose stack runs this on boot, and a seed that
silently doubles the dataset on every restart is worse than one that stops.
