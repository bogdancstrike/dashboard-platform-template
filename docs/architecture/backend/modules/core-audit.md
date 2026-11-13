# `src/core/audit`

The audit trail (§21) and the activity feed (§35), written from one place.

Two records come out of a single call because they answer different questions
and have different lifetimes:

  * **Audit log** — "who changed what, from what, to what, from where". Legal
    and forensic; retained, filterable, never edited.
  * **Activity entry** — "what happened around this project lately". Social and
    contextual; scoped to an entity so a detail page can show its own story.

`record` computes the field-level diff itself rather than trusting callers to
pass one, because a diff assembled by hand is a diff that drifts from what was
actually written.
