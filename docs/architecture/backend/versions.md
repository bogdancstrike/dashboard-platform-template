# Record version history with point-in-time restore (§17)

Record version history with point-in-time restore (§17).

"The audit diff exists; add point-in-time restore." So the versions *are* the
audit trail — no second ledger. Every write the product makes to a record is
already an audit row carrying the fields that moved, both sides
(`changes = {field: {from, to}}`). Reading those rows newest-first and
stepping the record's *current* state backwards through each `from` yields
the full state after every write: version N is now, version N-1 is now with
the last change undone, and so on back to the create.

Three consequences worth stating:

* **A version is a full state, not a diff.** Any two can be compared side by
  side, and "view as of a date" is the last version at or before it.
* **A record older than its audit trail still has a beginning.** When the
  oldest row is not the create (seeded data, a trail that was pruned), the
  state before the oldest change is shown as "earliest recorded", dated to the
  record's creation — honest about what is known.
* **Restore is a write like any other, and audited as one.** Restoring a whole
  version or chosen fields goes through the same coercion an edit does —
  vocabulary, bounds, and foreign keys that must still exist — under the edit
  permission *and* `records.restore`, refuses a lost race, and leaves an audit
  row with action `RESTORE` naming the version it came from. That row is in
  turn a version, so a restore can itself be undone.

Works for every explorer dataset with editable fields, and for contracts
(§13), whose writes leave the same shape of audit row.
