# The developer portal (§31): an API reference read from the platform itself

The developer portal (§31): an API reference read from the platform itself.

Nothing in the reference is typed by hand. The routes, methods and one-line
descriptions come from `maps/endpoint.json` — the table QF mounts — so an
endpoint is documented the day it exists. Who may call each one comes from the
handler's own guard (`@requires(...)`, `@authenticated`, `@optional`), read off
the decorator, so the permission on the page is the permission the code checks.
The longer description is the handler's docstring. Mounted parameters and the
operation id come from the Swagger document Flask-RESTX publishes at
`/swagger.json`. And the response shape is inferred from a real answer captured
by the try-it console (or seeded), so the schema shown is one this deployment
has actually returned.

Usage is computed from `api_request_logs` in PostgreSQL — requests per day,
errors, p50/p95 latency and the busiest routes, per API client.
