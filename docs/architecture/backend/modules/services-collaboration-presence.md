# `src/services/collaboration/presence`

Who is here: online, away, or gone (§47).

Presence rides the live channel. A socket opening says "online"; the browser
says "away" when the tab is hidden or idle and "online" when it comes back;
the last socket closing says "offline". Every change is broadcast as a hint —
`{"type": "presence", "user_id", "status"}` — which discloses nothing a
colleague directory does not already show.

**Workers do not share memory, so the truth is in Redis.** Each user has a
status key and a connection counter, both on a short TTL that the socket's
heartbeat refreshes. A worker that dies without closing its sockets therefore
stops vouching for them within a minute, rather than leaving somebody "online"
until the next deploy. Without Redis the same bookkeeping is kept in process,
which is exact for one worker and good enough for a laptop.
