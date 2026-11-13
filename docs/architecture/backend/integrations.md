# Connected systems (§26): what this platform talks to, and whether it works

Connected systems (§26): what this platform talks to, and whether it works.

Twelve providers, their settings, and the outcome of the last attempt to reach
each one. Five decisions, and the first two are the ones that keep this screen
honest.

**"Not configured" is derived, never trusted.** Whether an integration has what
it needs is a fact about its settings: every name in `required_settings` present
in `configuration` and not empty. The stored `status` used to be drawn
independently of the configuration, so three of twelve rows said
`NOT_CONFIGURED` while holding every setting they required — contradicting the
one fact this page exists to establish. `state()` computes it, and the column
cannot lie because nothing reads it for that purpose.

**A check verifies the configuration and says so — it does not claim to have
reached the provider.** Nothing in this template holds real Stripe credentials,
and a button that reported "Connected to Stripe" when no packet left the process
would be the worst possible lie on a screen whose whole job is to say whether
things work. So the answer is explicit about what was and was not tried, and
`last_error` records a failed *check* as a check.

**`enabled` is intent; `status` is outcome.** Which makes "switched on and
failing" a state that exists — and it is the row an operator most needs to see,
so it is not smoothed away into a single word.

**A secret is a reference, never a value.** `configuration` holds
`secret_ref: "STRIPE_API_TOKEN"`, a name that resolves in the deployment's own
secret store. Anything that looks like a value is redacted on the way out, since
an integrations screen that renders a token puts it in a screenshot.

**Nothing here is created or deleted.** The twelve providers are what the
platform knows how to talk to — a list that comes with the code, not one an
operator extends by typing a name. What they *can* do is configure, enable, and
check.
