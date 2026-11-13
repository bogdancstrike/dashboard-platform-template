# The system log viewer (§22): what the platform has been doing, and why

The system log viewer (§22): what the platform has been doing, and why.

Read-only, like the audit ledger and for a stronger reason: these rows are
written by `core/logsink` from the outcome of a request, so a log line somebody
could edit is a log line worth nothing. There is no create, no update and no
delete — pruning is `logsink.sweep`, bounded by `retention.log_days`.

Four decisions worth stating.

**It is built on `core/query.py`, like every other list.** One declaration
drives the SQL, the sort, the facets *and* the filter vocabulary the frontend
renders, so a filter the UI offers is by construction a filter the backend
honours. The alternative — a hand-written `WHERE` per parameter — is how a
service ends up with a `service` filter the page cannot see and a `logger`
control the server ignores.

**Level filters by severity, not by equality.** "ERROR" in a log viewer means
"errors and worse", because the reason somebody chose ERROR is that they are
looking for trouble and CRITICAL is more trouble. `LOG_LEVEL` is ordered
quietest-first for exactly this, and `_at_least` slices it — so a level added
to the vocabulary is ranked by where it is put rather than by a second list
here.

**The tail is a query, not a socket.** `since` takes the newest id the caller
already has and returns only what has arrived after it, so "live" is a poll the
client controls and can pause. A WebSocket would need a broadcast from every
worker for every request — a log stream that costs more than the requests it
describes — and a viewer that reconnects on a deploy shows a gap it cannot
explain. `after`/`since` also makes the pause honest: paused is simply not
asking, and resuming asks from where it stopped.

**One line's detail is a separate read.** The list carries the message and the
outcome; the context, the stack trace and the sibling lines that share the
correlation id are fetched when a line is opened. A list that carried every
stack trace would be a page weighing megabytes for the sake of the one row
somebody expands.
