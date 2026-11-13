# `src/services/collaboration/activity`

The activity feed (§35, §48).

Every notable thing that happened, in one place, in the order it happened.

**Why this is not the audit trail.** `services/audit.py` answers "what was done
to *this record*, exactly, by whom, from where, and what changed" — it is
evidence, it is scoped to one resource on purpose, and it sits behind
`audit.view`. This answers "what has been going on", it spans everything the
reader may see, and it needs only `records.view`. Two questions, two
permissions, two shapes. Serving both from one endpoint would mean either
publishing the ledger to everybody or hiding the feed from almost everybody.

**The strip is the filter, and the server counts it.** A feed is worth a page
only if it can be narrowed faster than it can be read, so the response carries
a count per kind over the *whole* matching set. Counting the page that was
downloaded would give a number that silently means "of the fifty I have" (§71)
— and the counts are what make the strip honest: a kind with nothing in it is
offered, greyed, at zero, rather than vanishing and leaving the reader to
wonder whether the platform has stopped recording comments.

**Scoped by organization, like everything else.** An entry belongs to the
organization it happened in; a reader sees their own. `resource_type` is
filtered against the declared resources so an unknown value is a validation
error rather than a query that quietly matches nothing.
