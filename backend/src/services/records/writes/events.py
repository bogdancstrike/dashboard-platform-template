"""Permissions, the concurrency key, and the hooks a record write announces."""

from __future__ import annotations

from src.core.events import Hook

CREATE_PERMISSION = "records.create"


UPDATE_PERMISSION = "records.update"


DELETE_PERMISSION = "records.delete"


#: How many times a create retries after losing the race for an identifier.
#: Two concurrent creates is ordinary; a hundred is a different problem, and a
#: loop that hides one is worse than an error that reports it.
_IDENTIFIER_ATTEMPTS = 5


#: Sent by a client that read the record first, to say which version it edited.
CONCURRENCY_KEY = "expected_updated_at"


#: `(session, resource, row, values, raw, principal=)` before an update is
#: applied; the first handler answering a dict holds the edit for approval.
update_requested = Hook("record.update_requested")


#: `(session, resource, row, changed)` inside the write, before it is audited:
#: state other features derive from the record.
derived = Hook("record.derived")


#: `(session, resource, row, changed, created=, principal=)` after the write is
#: audited and flushed: automations triggered by it.
written = Hook("record.written")
