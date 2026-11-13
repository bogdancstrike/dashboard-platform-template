# `src/seed/operations`

Platform operations: audit, activity, logs, jobs, flags, API, integrations.

These are the tables an operator opens when something is wrong, so the seed's
job is to make them *look* like a system that has been running — a log stream
whose levels are mostly INFO with a plausible tail of errors, jobs that mostly
succeeded, an audit trail whose entries line up with records that exist.

Audit rows carry both sides of the change and the computed field list, matching
what `core/audit.py` writes at runtime. A demo audit drawer that cannot show a
diff is a demo of nothing.
