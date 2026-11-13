# `src/services/collaboration/live`

Live delivery over WebSocket (§17), with a Redis fan-out behind it.

The problem this solves is the one every multi-worker deployment hits. A
gunicorn worker holds the sockets of the browsers that happen to have connected
to *it*. When another worker writes a notification, the reader is on the wrong
process and never hears about it. The symptom is a notification centre that
works perfectly on a developer's single-worker laptop and delivers about one in
four in production.

So a publish goes two places:

* **The local hub** — sockets held by *this* process, delivered immediately.
* **Redis pub/sub** — every other process, each of which delivers to its own
  local sockets when the message arrives.

Redis is still not a dependency. Without it, delivery degrades to
same-worker-only and the client's polling fallback covers the rest; with
`CACHE_ENABLED=false` the whole thing is local and the tests still pass.
