# Time tracking

Time tracking: timers, entries, the week grid, timesheets and reports.

Four rules the module keeps.

**Minutes are the truth.** A timer, a typed duration, a start and an end and a
cell in the week grid all end as one integer on one row, so every total —
the grid's, the timesheet's, a report's — is the same `SUM`.

**One running timer per person.** Starting a second stops the first: the
database's partial unique index forbids two, and quietly refusing to start is
worse than stopping the other with a note that it was stopped.

**A submitted week is locked.** Entries whose date falls in a SUBMITTED or
APPROVED timesheet cannot be added, edited or removed; a rejection unlocks the
week, and resubmitting raises a fresh approval.

**Your own time is yours; everybody's is `time.approve`.** Reading somebody
else's week, the team view and the reports across people are the approver's.
