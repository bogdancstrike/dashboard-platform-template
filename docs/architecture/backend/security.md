# The reader's own security page (§41): sessions, sign-ins, and what to worry about

The reader's own security page (§41): sessions, sign-ins, and what to worry about.

Three tables, one subject: **you**. Every query here is scoped to
`principal.user_id` and there is no permission to hold, because being signed in
is the qualification for seeing your own sessions. That is not laxity — it is
the point. A security page that needed granting would be one most people never
see, and the whole value of this one is that the person whose account it is can
look at it without asking anybody.

Five decisions worth the reader's attention.

**Revoking a session actually revokes it.** `UserSession`'s docstring had said
since it was written that a revoked session is refused on its next request —
and nothing read the table at all. So this page would have offered a "sign out
this device" button that left the device signed in, which is worse than
offering nothing: a control that does nothing is one people rely on.
`core/auth/sessions.touch_session` is the other half, and it is where the guarantee
lives; this is only the button.

**"Current" is derived from the request, not read from a column.** Which
session you are looking at the page *from* is a fact about this request, and
`principal.session_id` is the authority. The stored `is_current` is maintained
too — the administrator's user drawer has no request to derive it from, so for
them it means "the session that most recently made a request" — but this page
never trusts it. The seed marked the first five sessions of every user as
current, so a person with three had three of them claiming to be the one they
were using.

**A failed sign-in is the most important row on the page**, and it is the one a
naive implementation drops. `LoginEvent` records failures with a reason, and
somebody trying your password from an address you do not recognise is exactly
what this page exists to show — so failures are counted separately, surfaced
first, and never merged into a "recent activity" list where they read as
ordinary.

**Nothing here can be deleted.** A session is revoked, an event is resolved,
and the sign-in history is a record. A security page whose rows can be tidied
away is one an attacker tidies away.

**You cannot revoke the session you are using by accident.** It is offered —
signing yourself out is a reasonable thing to want — but it is a distinct
action with its own confirmation, because pressing "revoke" down a list and
landing on your own row is how somebody loses their work.
