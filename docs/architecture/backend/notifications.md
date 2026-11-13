# The notification centre (§17), and the fan-out behind the live feed

The notification centre (§17), and the fan-out behind the live feed.

Two things live here:

* **Reading and marking.** A list, filterable, with unread counts, and the two
  operations that actually matter — mark one, mark all.
* **Publishing.** `publish()` writes the row and hands it to whoever is
  listening on a WebSocket. Writing and delivering in one call is what stops
  the two drifting: a notification that exists in the database but never
  reached the browser is indistinguishable, from the reader's side, from one
  that was never created.

Grouping is by `group_key`. Twelve "assigned you a task" rows are one line with
a count, not twelve lines burying everything else — which is how a notification
centre becomes something people close rather than read.
