# The read-only tools a Data-mode conversation may call (§41)

The read-only tools a Data-mode conversation may call (§41).

Every tool goes through the service the UI itself uses — the explorer's
query, the record page's detail, global search — with the *caller's*
principal, so the assistant can never read a row its user could not open
themselves. Nothing here writes.

Each tool returns ``(payload, citations)``: what the model reads back (kept
small — rows are trimmed to the fields that identify them), and the records
it was shown, which the answer cites with links.
