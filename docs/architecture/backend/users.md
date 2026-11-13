# User administration (§12)

User administration (§12).

Three things an administrator needs of a person, and one they must be able to
do carefully:

* **Find them** — a list filtered, sorted and faceted in SQL like every other
  list, off one `FieldSet` declaration (§71).
* **Understand their access** — not just "role: Manager", but the *effective*
  permission set, which is the role's plus every group's. A screen that shows
  the role alone cannot explain why somebody can cancel a job.
* **Change it** — role, status, groups — audited, in the same transaction.
* **See what they see** — impersonation, which `core/auth` already implements
  by header. What lives here is the part that decides *who may be
  impersonated*, because that is an authorization question rather than a
  transport one.

Credentials are not here and never will be: Keycloak owns them. This table
holds no password, and `mfa_enabled` mirrors the realm for display rather than
configuring it.
