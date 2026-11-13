# Creating, editing and deleting one record (§9, §73)

Creating, editing and deleting one record (§9, §73).

The read half (`services/records.py`) renders whatever a `Resource` declares.
This is the mirror of it: what a form may *write* is declared on the same
resource, so the fields an edit form offers are the fields the API accepts and
neither list can drift from the other.

Four decisions are worth the reader's attention.

**A payload is coerced against the declaration, never trusted.** The field
already knows its kind and, for an enum, its closed vocabulary; the write
declaration adds the bounds. So "status must be one of these seven" is
enforced by the same tuple the filter menu is built from, and adding a status
to the vocabulary makes it settable without touching this module.

**Foreign keys are checked before the INSERT, from the schema.** A dangling
`assignee_id` would otherwise reach PostgreSQL and come back as an
`IntegrityError` — a 500 for what is plainly a bad form value. The target
table comes from the column's own `ForeignKey`, so a new relation is validated
the day it is declared rather than the day somebody remembers this file.

**An edit that lost a race is refused, not applied.** A client may send the
`updated_at` it last saw; if the row has moved on, the write is a 409 naming
both moments. Without that, two people dragging the same card produce a last
write that silently discards the first — the failure §73 exists to prevent.

**The human identifier is generated, never accepted.** `TSK-00042` is the
string people quote to each other, so the server owns it: the highest existing
one plus one, retried if another request took the same number in between.
