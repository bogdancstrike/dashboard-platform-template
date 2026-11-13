# Exports

Exports somebody asked for and can come back to (§30).

`core/export` answers a download inside the request. This module is the other
half: the export that is too big for one, and therefore has to exist as a
*thing* — a row with a reference, a status, a row count and a file — rather
than as a response that either arrived or did not.

Five decisions, each of which is a mistake this file exists not to make.

**The refusal and the queue are the same number.** A download stops at
`core/export.MAX_ROWS`; above it `refuse_if_truncated` raises and says to queue
one instead. That message named a path that did not exist until this module,
which is the worst kind of error message — one that tells somebody to do
something the product does not offer. `limits.max_export_rows` is the bound on
the queued path, and it is read from the settings table rather than declared
here, so the number an administrator edits is the number that applies.

**A queued export is the same question as the download would have been.**
Both build their statement from an `explorer.Plan`, so an export that queued
*because* it was large cannot quietly be a different query from the one the
person was looking at. The plan is stored on the job, re-validated when it
runs, and re-described from the resource's own field catalogue — never from a
sentence saved beside it that would go stale.

**The file is produced, not promised.** There is no worker in this stack, so
`core/background` runs the work off the request inside this process and records
which mechanism did it. What comes back is genuine: real rows, a real byte
count, a real checksum, and a download that returns them. A page whose every
download fails is not a demonstration of anything — the same argument
`seed/blobs` makes about files, and the reason the seeded exports have real
artefacts too.

**The person who asked is the person who may fetch it.** An export is a copy of
whatever rows its requester could see, filtered however they filtered them, and
a link to it is a link to those rows. So `/exports` lists your own and a
download requires being the initiator — administrators included, deliberately.
An administrator who needs somebody's export can run the query themselves,
which leaves an audit entry in their own name; a download endpoint that made an
exception for them would be a way to read another person's data with no such
record. Job *metadata* stays visible to `jobs.view` on `/admin/jobs`, because a
queue console that cannot see its own queue is useless.

**An artefact expires, and is discarded before the record is.**
`retention.export_days` bounds how long the bytes live, and the bytes are
dropped the moment an expired one is asked for — lazy, because there is no
sweeper to be honest about, and cheap because it happens exactly where the fact
is discovered. `forget` is the manual version, and it takes two presses: the
first removes the file, the second removes the record. Two, because the acts
are different sizes — one takes a copy of production data out of object
storage, the other tidies away somebody's own note that they asked for it — and
because the history that matters lives in the audit trail (`export.queue`,
`export.download`, `export.forget`, `export.remove`), which the requester
cannot edit. The first design kept the row forever by analogy with
`/admin/jobs`; that analogy fails, because a queue console shows scheduled work
nobody asked for personally, and this shows one person's own requests.
