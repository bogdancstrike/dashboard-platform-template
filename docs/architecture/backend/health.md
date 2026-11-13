# Dependency probes behind the health endpoints and the system-health page

Dependency probes behind the health endpoints and the system-health page.

Three levels, because three different callers ask three different questions:

* **liveness** — is this process running? No I/O at all. A liveness probe that
  touches the database restarts a healthy API every time the database hiccups,
  which turns a brief outage into a crash loop.
* **readiness** — can this process serve a request? The database must answer;
  the cache must not, because `core/cache.py` degrades to a miss by design.
* **snapshot** — everything, with latency and last error, for §24.
