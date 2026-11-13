# Authentication and authorization (`src/core/auth/`)

Authentication against Keycloak, the permission catalogue, and the guards.

Keycloak owns identity; the platform owns authorization *detail*. That split is
deliberate:

* **Keycloak** proves who the caller is and which realm role they hold. The
  access token is verified against the realm's JWKS on every request.
* **The platform** turns that role into a permission set, from the editable
  `roles` table. Which means the roles-and-permissions admin screen (§13) is a
  real screen that changes real behaviour, without an admin having to leave the
  application to edit an identity provider.

Code always asks "may this principal export records?", never "is this an
admin?" — the second question has to be re-answered in twenty places the day a
new role appears.

Realm role → platform role code is a straight uppercase mapping
(`administrator` → `ADMINISTRATOR`); when a token carries several, the
highest-ranked one wins.
