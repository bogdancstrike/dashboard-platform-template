# Mail

The mailbox (§14–§16): threads, messages, drafts and sending.

Five decisions shape this module.

**A mailbox belongs to exactly one person, and that is the whole access
model.** Every query here is scoped to `owner_id == me`. There is no sharing
scope, no polymorphic share table and no "public" mailbox, because a mailbox is
not that kind of object — and the moment one exists, every endpoint needs a
second rule about whose mail this is. `mail.access` says you have a mailbox;
your own id says which.

**The thread is the unit of the list, and its counts are recomputed rather
than adjusted.** `message_count`, `unread_count`, `snippet` and `participants`
are denormalised onto the thread on purpose — an inbox list that joined
messages to render a row is an inbox nobody waits for. But a *decremented*
counter drifts the first time two things happen at once, so every write that
could change one recomputes all of them from the messages. One function,
`_recount`, and nothing else touches those columns.

**Reading a thread marks its messages read, and that is a write.** Honest
rather than clever: they *were* on screen. The same reasoning as the
announcements board, and the same consequence — the count on the folder is a
fact about rows, not about what the browser has drawn.

**Sending puts a message in OUTBOX, not in SENT.** There is no mail transport
in this template. Writing `SENT` would have the mailbox claim a delivery it
cannot make, and a demo that lies about the one thing a mail client is for is
worse than one that says "queued". §23 is where the transport goes.

**A draft is a message, not a separate kind of thing.** `is_draft` and a null
`sent_at`, in the same table, so a draft appears in searches, carries
attachments, and becomes a sent message by being sent — rather than being
copied from one table into another and leaving two ids behind.
