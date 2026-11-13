# `src/seed/collab`

Collaboration seed (§47–49): channels with history, record threads, a wiki,
and meeting notes with action items.

Unlike the generators in `business.py` and `content.py`, this module reads the
database it seeds: a channel needs real people, a meeting note needs a real
calendar event, an action item a real task. So it runs *after* the main graph
is written (`runner.run`), and the same function is the `--sync-collab` repair
for a database seeded before collaboration existed — it adds what is missing,
by name, and never touches what somebody has since written.

Every time is relative to now, so a database seeded today and one seeded in a
month both open on a chat whose last message was minutes ago.
