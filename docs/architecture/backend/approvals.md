# The approvals inbox: one queue for everything that needs a decision

The approvals inbox: one queue for everything that needs a decision.

Three ideas carry the module.

**A request is generic; its meaning is a provider's.** Timesheets, access
requests, held-back record edits and report publishing all land in
`approval_requests` with the same columns. What differs — who may decide, what
approving *does*, how long an answer may take — is a `Provider` registered by
the feature that raises the request. A new kind of decision is a new provider,
not a new inbox.

**Nobody approves their own request.** Holding the deciding permission is not
enough when the request is yours; the inbox shows it under *Mine* instead, and
`decide` refuses it with the reason.

**A decision is a write in the same transaction as its effect.** Approving an
access request adds the membership; approving a change applies the held
values; both commit with the status change and the notification, or none of
them do.
