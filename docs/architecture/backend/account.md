# The current user's platform profile and personal preferences (§40, §58)

The current user's platform profile and personal preferences (§40, §58).

Keycloak proves identity, while this service returns the application-side
profile: organization membership, the live role definition and preferences.
Keeping this query behind one endpoint gives the SPA one authoritative answer
for both its identity chrome and every permission-aware navigation decision.
