# `src/seed/exports`

Real files for the seeded exports (§30).

`seed/blobs` exists because a seeded file with a `storage_key` pointing at
nothing is a file manager whose every download fails, which demonstrates
nothing. An export is the same argument with a worse version of the problem:
the seeded export jobs did not merely lack their bytes, they *claimed* them —
`result` said `{"rows": 184203, "artifact": "exports/JOB-000004.csv"}` for a
file nobody had written, and the row count was a progress counter rather than a
count of anything.

So this module makes every seeded export true, and it does it by running the
same `services/exports.produce` that a real request runs. Nothing here writes a
plausible number:

**The query is resolvable.** The old payload named an `entity` no code could
turn into a dataset. It is now a resource key, validated through
`explorer.replan`, and a row whose query cannot be read is left alone and
reported rather than guessed at.

**The unit counts are the query's.** `total_units` used to be a random integer
up to 250,000, so a finished export could report itself 100% complete at 184,203
of 250,000 units — three numbers, no two of which agreed. They are now counted
from the statement the payload names.

**The artefact is the file that was written**, with the size and checksum of the
object storage actually holds.

Idempotent, and additive in the sense that matters: it writes bytes that are
missing and corrects numbers that describe them. It never invents an export and
never removes one. Safe on every seed, and on a database that predates any of
this — which is what `--sync-exports` is for.
