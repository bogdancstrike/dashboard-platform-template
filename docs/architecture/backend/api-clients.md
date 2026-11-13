# API clients and their credentials (§25): machines that call the platform

API clients and their credentials (§25): machines that call the platform.

A client is a *consumer*; a credential is one key it may call with. One client
can hold several — which is the whole reason rotation is possible without an
outage.

Five decisions, and the first two are the ones that matter.

**A secret is shown once, at creation, and never again.** Only `secret_hash`
is stored, so this is not a policy but a property: there is nothing to show a
second time. The plaintext appears in exactly one response and is never
reachable again, which is why the answer says so in the same breath.

**A client cannot be scoped beyond what its creator holds.** Scopes come from
the permission catalogue, so granting one to a machine is granting a
permission — and a client scoped `users.impersonate` is a machine that can
become anybody. Without this rule `api.manage` would be a path to every
permission in the catalogue, the same way `users.manage` would have been on
`/admin/groups`. Only ADMINISTRATOR holds `api.manage` today; the rule is here
so that stays true if a narrower role ever gets it.

**Rotation issues a new credential rather than replacing one.** `rotated_from`
records the chain, and the old key keeps working until its own expiry — a
rotation that killed the previous secret the instant a new one was minted is
not a rotation, it is an outage with extra steps. The old one is given a short
expiry rather than left forever, so "rotate" still means something.

**A revoked credential is kept.** Revocation is what somebody does when a key
has leaked, and the question afterwards is always *when, and by whom* — a row
that vanished answers neither. It is refused for a second time rather than
silently accepted, because "revoke" twice suggests the first did not take.

**The two windows of numbers are labelled, not merged.** `requests_total` and
`error_rate` are lifetime counters the gateway maintains; `api_request_logs` is
a recent window it keeps. Three point seven million against twelve logged rows
is not a contradiction, it is two different questions — but a screen that put
them side by side unlabelled would read as one.
