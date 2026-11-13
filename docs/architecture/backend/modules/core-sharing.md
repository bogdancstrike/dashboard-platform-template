# `src/core/sharing`

One sharing model, for everything a person can save (§5, §28, §45, §46).

Saved searches, reports, saved views and dashboards all answer the same three
questions — who can see this, who can change it, and how does the owner hand it
over — and the tracker's requirement is explicit: *one mechanism, one table,
one set of rules; a second sharing model is a second set of bugs*.

So the rules live here rather than in each service:

* **Private by default.** Nothing is shared by accident.
* **Shared** means the owner plus explicitly added members, who may read and
  run it and nothing more.
* **Public** means every signed-in person can see it. Member rows are kept, so
  flipping back to Shared restores exactly the previous audience instead of
  losing it.
* **Only the owner writes.** A member who wants their own version duplicates
  it, and the copy is theirs and private.

Visibility is one SQL predicate — `owner = me OR scope = PUBLIC OR id IN (my
shares)` — rather than fetching everything and filtering in Python, because the
alternative reads the whole table to show somebody three rows (§71).

`resource_shares` is polymorphic (`resource_type`, `resource_id`, `user_id`),
so adopting this for a new kind of saved thing costs a string, not a table.
