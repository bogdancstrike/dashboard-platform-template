# Comments

Comments on any record (§36).

Polymorphic, like tags and favourites: `resource_type` + `resource_id` rather
than a column per entity, so a screen that wants a conversation gets one
without a migration. The alternative — `task_comments`, `ticket_comments` — is
a schema change every time somebody adds a page, which is exactly what a
template must not teach.

Three decisions worth stating.

**Reading a comment needs the record's own permission.** A conversation about a
ticket is part of the ticket; anybody who may open the record may read what was
said about it. Writing is separate (`records.comment`), because a reader who
may look at the ledger is not automatically somebody who may annotate it.

**Editing is the author's alone, and it is marked.** A comment that can be
silently rewritten is not a record of a conversation. `edited_at` is set on the
way through and rendered beside the body.

**Mentions are resolved at write time.** The ids of the people named with `@`
are stored alongside the body, so "what am I mentioned in?" is an indexed
question rather than a scan that re-parses every comment ever written.

**A commentable thing is not always an explorer resource.** Most are — a
ticket, a task, a project — and their permission comes from the declaration.
But a kanban card is not a business record with a field catalogue; who may
read it is decided by the *board* it is on. So the permission lookup is a
small registry (`COMMENTABLE`) rather than a hard call into the explorer, and
adding a screen that wants a conversation still needs no migration — only a
line saying which rule authorises it.
