# Records on a map (§44, §61)

Records on a map (§44, §61).

The analysis compiler groups one table by its own columns, deliberately: it
does not join, because a compiler that joins is a compiler with a second
language in it. That is exactly why a map needs its own service. "Where are our
orders?" is answered by the *customer's* city, and "how is the fleet doing in
Northern Europe?" by the region a device's row points at — one hop away, in
another table, every time.

So this is not a second copy of the compiler; it is the one shape of question
the compiler cannot express. What it deliberately keeps is the compiler's
habits:

**Aggregated in PostgreSQL.** One `GROUP BY` per view, not a fetch of every row
followed by a count in Python. A map of four thousand devices that downloads
four thousand devices is a map nobody waits for (§71).

**Everything is declared.** Which datasets can be mapped, how each one reaches
a place, and what may be measured on it are the `MAPPABLE` table below —
checked against the same `Resource` permission the list and the explorer check,
so a caller who may not read devices cannot read where the devices are.

**What cannot be placed is counted, never dropped.** A row whose city is not in
the gazetteer, or which names no place at all, is real: "1 240 customers, 89 of
which we cannot place" is the honest sentence, and a map that quietly draws
1 151 dots answers a different question from the list beside it.
