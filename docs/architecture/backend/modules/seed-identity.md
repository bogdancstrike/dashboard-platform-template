# `src/seed/identity`

Regions, roles, organizations, the org tree, and the people in it.

Everything else references a user or an organization, so this runs first and
the rest of the seed reads its output from the `World`.

The five realm personas (`admin@nucleus.example` and friends) are created here
with the emails Keycloak carries. `core/auth.py` matches an incoming token to a
local profile by external subject, then by email — so a reviewer who signs in
as `admin` adopts the seeded profile instead of provisioning an empty one, and
lands on a populated application rather than an empty one.
