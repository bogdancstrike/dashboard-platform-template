# One gesture over many records (§43, §75)

One gesture over many records (§43, §75).

A list that can only be changed a row at a time is a list somebody changes with
fifty clicks, and the fifty-first is the one they get wrong. So: tick some
rows, or say "everything matching what I am looking at", and apply one change.

Four decisions carry this module.

**The preview is a separate call, and it is not optional.** "Change the status
of everything matching this filter" is a sentence whose consequences the reader
cannot see — the filter might match nine rows or nine hundred, and the number
is the whole basis for deciding. §75 asks for the affected count split into
*selected by hand* and *selected by filter*, because those two are trusted
differently: somebody who ticked twelve boxes knows what is in them, and
somebody who filtered does not. The preview answers with both numbers, a few
of the actual labels, and every reason a row would be refused.

**A filter selection is resolved by the list's own query.** `explorer` already
validates a question and turns it into a statement; bulk asks it for that
statement rather than applying filters itself. A second filter implementation
is a second place for "case-insensitive" to be decided differently, and the
first time the two disagreed somebody would have changed rows they never saw.

**Partial success is the normal outcome, and it is reported as one.** Fifty
rows, one of which lost a race and one of which somebody else already deleted,
is not a failure and not a success: it is forty-eight applied and two refused,
each with the reason. Returning 200 with both halves is the only answer a
reader can act on — a 500 hides the forty-eight, and a 200 with no detail hides
the two. Each row is attempted in a savepoint, so one refusal does not roll
back the ones before it.

**The writes are the single-record writes.** `record_writes.apply_values` and
`remove_row` are what a form and a drag already use, audit included — so a
bulk of two hundred leaves two hundred ledger rows saying the same thing two
hundred single edits would have said, and a status change reads as a status
change rather than as an edit.
