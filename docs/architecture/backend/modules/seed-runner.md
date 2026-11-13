# `src/seed/runner`

Builds the whole dataset in memory, then writes it in one transaction.

Two decisions carry the design:

**Everything is built before anything is written.** Ids are generated from the
seeded stream up front, so a project can reference a customer that has not been
inserted yet and the whole graph is consistent by construction rather than by a
sequence of read-back queries.

**Cross-table cycles are deferred, not avoided.** `users.manager_id` points at
`users`, `departments.manager_id` points at `users` while `users.department_id`
points back at `departments`. PostgreSQL checks a foreign key at INSERT, not at
COMMIT, so those columns are held back, everything is inserted, and then they
are filled in and flushed a second time. The alternative — making the
constraints DEFERRABLE — changes the schema to suit the seed, which is the
wrong way round.
