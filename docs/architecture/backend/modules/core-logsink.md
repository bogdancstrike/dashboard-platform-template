# `src/core/logsink`

The platform's own request log, written to the table `/admin/logs` reads.

Without this the log viewer is a table of fiction: the seed writes two hundred
plausible lines whose correlation ids match nothing, so the one thing a log
console exists for — somebody pastes the id from an error screen and finds the
request — cannot be demonstrated at all. The id already exists, `core/errors`
already puts it in every failure payload and the frontend already prints it on
its error screens; this closes the loop.

Four decisions, each of which is the difference between a log sink and an
outage.

**It never affects the response.** The row is written in its own session after
the response is built, and every failure inside is swallowed. A logging table
that is full, locked or gone must not turn a working request into a 500 — and
the request has already succeeded by the time this runs, so there is nothing
left to fail into.

**It is not in the request's transaction.** A rolled-back request is exactly
the one worth having a log line for; sharing its session would delete the
evidence with the cause.

**It logs requests, not chatter.** Health probes answer every few seconds from
the container's own health check, and the log endpoints themselves would each
write a line about being read — a table that grows when somebody looks at it,
and a live tail that never settles because it keeps reporting itself. Both are
excluded by prefix.

**Level comes from the outcome, not from the caller.** `>=500` is ERROR, `>=400`
is WARNING, a slow success is WARNING too, and everything else is INFO — so
filtering by level answers "what went wrong" rather than "what did somebody
choose to call important".

Retention is `retention.log_days`, which was a seeded setting before there was
anything writing rows for it to bound. Pruning is `sweep()`, called from the
same place a deployment would call any other periodic job.
