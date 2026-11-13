# The calendar

The calendar (§19): a window of time, and what is in it.

Four decisions shape this module.

**A window is the query, and recurrence expands here.** The browser asks for
`from`/`to` and gets *occurrences*, not rows. Expanding a series in the browser
would mean a second implementation of the recurrence rule, and the two would
disagree about the last Friday of a month long before anybody noticed. The
model materialises `recurrence_until` for exactly this reason: a series that
cannot reach the window is excluded by a range scan rather than expanded and
thrown away.

**An occurrence is derived and says so.** Its id is `<event id>:<start>`, which
is stable enough to key a grid on and obviously not a primary key. Editing an
occurrence edits the *series*, and the API says which — per-occurrence
exceptions are a second table, a second set of rules about who may change what,
and a question nobody has asked yet.

**"Who is coming" is a fact about a person, and only they may state it.** The
participants list carries each invitee's own response, and `respond()` will only
write the caller's own entry. An organiser who could accept on somebody's behalf
turns an attendance list into a guess.

**A clash is computed, never stored.** Two events overlapping is a fact about a
*reader* — the same pair is a clash for the two people in both and irrelevant to
everybody else — so it is worked out over the window that was asked for, for the
person who asked.
