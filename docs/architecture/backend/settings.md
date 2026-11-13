# System settings and feature flags (§11, §27)

System settings and feature flags (§11, §27).

Two tables, one module, because they are the same *kind* of thing: runtime
configuration an administrator changes without a deploy. Four decisions.

**A setting is one row per key, and it declares its own type.** `value_type`
and `options` are what the form is rendered from, so a boolean gets a switch
and a choice gets a select — and adding a setting needs no frontend change at
all. A single JSON document of configuration would render as a textarea and
audit as "the settings changed".

**The default is carried beside the value, so drift is visible.** Knowing what
a setting *was* shipped as is the difference between "somebody chose this" and
"this is how it comes" — and it makes Reset a button rather than a migration.

**A secret is never sent.** `is_secret` rows come back with the value replaced
by whether one is set. A settings screen that renders an API key is a settings
screen that puts it in a screenshot, a browser cache and a support ticket.

**A flag says who it is on for, and the answer is computed here.** Percentage,
roles, groups and named people all narrow the same flag, so "is it on for me"
has one implementation — in the service, next to the rollout it reads. Two
implementations of that arithmetic is a flag that is on in the UI and off in
the API.
