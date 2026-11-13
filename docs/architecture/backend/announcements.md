# Announcements — the platform talking to the people using it (§17, §34)

Announcements — the platform talking to the people using it (§17, §34).

**Why this is not a notification.** A notification is *one person's*: it is
addressed, read once and gone. An announcement is a *notice* — written once
for many readers, true for a window of time, and whether a given person has
seen it is a fact about that person rather than about the notice. See
`models/platform.Announcement` for what that costs either way round.

Three decisions shape this module.

**"Live" is computed, never stored.** A notice is live when its status is
`PUBLISHED`, its `publish_at` has passed and its `expires_at` has not. A
`status` column swept to `EXPIRED` by a job is a column that is wrong between
sweeps, and the sweep is exactly the thing nobody notices has stopped. So
`expired` is derived on read and the window is a `WHERE` clause.

**The audience is what a reader *is*, never a list of who they are.** An empty
`audience_roles` means everybody; a role code means anybody holding it; an
`organization_id` scopes it to one tenant. A notice addressed by enumerating
recipients silently misses whoever joined after it was written — which for a
maintenance window is the population that most needs it.

**Reading and acknowledging are separate facts.** "Everybody has seen it" and
"eleven people have agreed to it" are different questions, and a notice that
asks for a response has to be able to answer the second. Receipts are written
on the reader's action, not at publish time: a row per reader created up front
grows with (notices × people) whether or not anybody looked, and turns editing
a published notice into a write to thousands of rows.
