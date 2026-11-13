# The built-in kinds of approval: access, held-back changes, report publishing

The built-in kinds of approval: access, held-back changes, report publishing.

Each is a `Provider` (see `services/approvals`) plus the entry point that
raises it. Timesheets register themselves from `services/timekeeping`.

**Access requests** come from a forbidden page: the reader asks for the
permission that page needed. Approving one adds the requester to a governance
group named for that permission — created on first use — so the grant is
visible, revocable and audited in the groups screen rather than being a quiet
edit to somebody's role.

**Change requests** are record edits a `ChangeRule` holds back. The values are
kept exactly as submitted and re-coerced when approved, so an edit approved a
day later is validated against the record as it is then.

**Report publishing** is the step from a private report to one the whole
organisation reads.
