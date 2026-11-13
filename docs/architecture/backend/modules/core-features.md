# `src/core/features`

Feature flags, enforced (§27).

The catalogue (`core/feature_catalogue.py`) says what each flag controls; this
module makes the API, the background jobs and the live channel obey it.

**One place in the request pipeline.** `install(app)` adds a `before_request`
hook. At boot every endpoint in `maps/endpoint.json` is resolved to the flag
that owns it (most specific pattern wins), keyed by the Flask rule QF mounts
it at. A request to an owned endpoint is evaluated for *its caller*; when the
flag is off it is refused before the handler runs:

    404  {"error": "feature_disabled", "feature": "<key>", "message": ...}

**Why 404 and not 403.** A 403 says "this exists and you may not" — the
frontend answers it with "ask an administrator for a role", which is a lie
when the feature itself is off, and a switched-off feature should not even
confirm that its surface exists. 404 is what the endpoint is, for this reader:
not there. The `error` code is what clients branch on; the status is only
what proxies and generic clients see.

**Per caller.** Rollout percentage and targeting (people, roles, groups,
organizations) are evaluated against the principal, with the same function the
flags screen and `/api/me` use (`services.settings.is_on`). A request with no
principal — a public form, a public dashboard, a webhook — and a background job
are evaluated *globally*: the flag must be switched on. Targeting narrows who
has a feature; it cannot be satisfied by nobody.

**Cached briefly, invalidated on change.** The flag rows are read once per
*generation* (a Redis counter bumped by every flag write — `cache.bump`) and
held in-process for at most `LOCAL_TTL` seconds, so a toggle reaches every
worker on its next request, and a Redis outage costs at most `LOCAL_TTL` of
staleness rather than a database read per call.
