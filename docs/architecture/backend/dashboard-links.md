# Public and embeddable dashboard links (§25), with expiry and passwords

Public and embeddable dashboard links (§25), with expiry and passwords.

**A link is a token, and the token is the credential.** 32 random bytes,
URL-safe; the address is `/share/dashboards/<token>`. A link can carry a
password (stored as a salted hash), an expiry, a list of origins allowed to
embed it in an iframe, and it can be revoked. Every successful view counts.

**A password is exchanged for a grant.** `POST …/unlock` checks the password
and answers with a short-lived signed grant (`itsdangerous`, keyed on the
app secret) naming the link and its password version — so changing the
password lapses every grant already handed out, and the password itself is
never sent twice.

**The data is resolved on the server, as the owner, read-only.** A public
reader has no session, so the page cannot call the dataset endpoints a widget
normally uses. Instead the public endpoint answers each widget's question
itself, through the *same* services those endpoints use (explorer insights
and queries, the analysis compiler, saved reports), as a principal built from
the dashboard owner with only the read permissions — so a public dashboard
can never show more than its owner could see, and nothing on it can write.
Widgets that are a window onto somebody's own workspace — mail, tasks,
notifications, files — are not published; they render as "private".

**Rate limited.** Views per address per link per minute, and password
attempts far more tightly, in Redis when it is there and in-process when not.
