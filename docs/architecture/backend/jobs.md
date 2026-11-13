# The background job queue (§23): what ran, what failed, what can be tried again

The background job queue (§23): what ran, what failed, what can be tried again.

Read like the log, written like a control panel — and the writes are the point.
`jobs.view` reads; `jobs.manage` retries and cancels, and those two verbs are
where every decision in this module lives.

Four decisions worth stating.

**Retry and cancel are gated on the *state*, not on the permission alone.** A
job that is still running cannot be retried, because retrying it would put two
runs on the same rows — the commonest way a queue console corrupts the data it
was built to supervise. `JOB_TERMINAL` and `JOB_CANCELLABLE` in
`core/vocabulary` are the two sets that decide it, and both are named in the
refusal so a disabled button can say why (§76).

**Not every kind is this console's to retry.** An export is re-*requested*
rather than retried, because its stored query would run against rows that have
moved on — `NOT_OURS_TO_RETRY` names the kinds and the refusal names where the
right action lives. Two screens giving opposite answers about the same row is
worse than either answer.

**A retry is a new attempt on the same job, not a new job.** `attempt` goes up,
the outcome fields are cleared, and the history is kept: `attempt 3 of 3` is the
fact an operator needs, and a queue that made a fresh row per retry would lose
the connection between them and count one failure as three.

**`max_attempts` is a real bound, and a raisable one.** A job that has used its
attempts is refused with the number named — and `allow_attempts` is how an
operator grants more, deliberately and audited. The refusal said "raise the
limit if it should be tried again" before there was any way to do that, which
is the worst kind of error message: one that names a fix the product does not
offer. Itself bounded by `MAX_ALLOWED_ATTEMPTS`, because "retry until it works"
is how a broken job writes the same rows forty times.

**A cancel is not a delete.** The row stays, CANCELLED, with who stopped it and
when — a queue whose cancelled jobs vanish cannot answer "why did the nightly
export not run last Tuesday", which is the question it gets asked.

There is no create. Nothing in the platform enqueues a job yet: `/exports`
(§30) is where that belongs, and the honest state of affairs is recorded rather
than papered over with a "New job" button that would only ever write a row no
worker reads.
