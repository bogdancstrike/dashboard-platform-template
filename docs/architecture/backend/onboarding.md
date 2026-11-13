# Onboarding (§38): a checklist per role, empty-state guides, and sample data

Onboarding (§38): a checklist per role, empty-state guides, and sample data.

**The checklist differs by role** because the first week differs by role: an
administrator invites people, sets roles, connects a system and configures an
SLA; a manager builds a dashboard and a board; an operator triages, logs time
and closes a task; an analyst saves a search and runs a report.

**Most steps tick themselves off.** A step names a check — "has this person
created a dashboard", "has this person changed a role" — answered from the
records and the audit log, so the checklist reflects what was *done*, not what
was clicked. A person may still mark a step done or skip it; that answer is a
row in `onboarding_steps`. Progress is per person.

**Sample data is tagged and removable.** Loading an area creates records
through the records API's own bulk create (validated, named, audited without
flooding the activity feed) and records every id in `sample_records`; removing
it deletes exactly those ids — and nothing else — so a demo can be undone on a
database that also holds real work. Administrators only.
