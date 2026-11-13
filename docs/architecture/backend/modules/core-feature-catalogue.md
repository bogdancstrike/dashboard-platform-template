# `src/core/feature_catalogue`

The feature catalogue — every switchable feature, and everything it controls (§27).

One declaration per feature, and it is the **single source of truth** for:

* the seeded `feature_flags` rows and the `--sync-flags` repair (`seed/`),
* which API endpoints refuse when the flag is off (`core/features.py`, which
  reads `endpoints` against `maps/endpoint.json` at boot),
* which background jobs and live-channel messages are skipped,
* and what the administration screen says will disappear when somebody turns
  a flag off — routes, navigation entries, endpoints and components.

The frontend names the same keys and routes in `src/settings/features.ts`;
`tests/test_feature_flags.py` holds the two to each other, and fails when an
endpoint in the map belongs to neither a flag nor `CORE_ENDPOINTS`. That last
check is the point: a new endpoint arrives with a *decision* about whether a
flag governs it, not with an accident.

**Endpoint patterns** are `api_url` templates exactly as the map spells them
(`/api/time/entries/<uuid:entry_id>`), or a prefix ending in `*`. The most
specific pattern wins across the whole catalogue, so `/api/dashboards*`
(dashboard builder) and `/api/dashboards/<uuid:dashboard_id>/links*` (public
links) can both be declared and each endpoint has exactly one owner.

**`requires`** names parent flags: a child is on only when every parent is on
for the same reader. The AI features all hang off `ai`, so one switch takes
every model call out of the product.

**Defaults.** Every shipped feature defaults to on at 100 %. A flag is a way
to switch a finished feature *off*; a seed that rolled dice over finished
features is how `/dashboards` once vanished from every demo persona.
