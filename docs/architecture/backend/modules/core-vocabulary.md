# `src/core/vocabulary`

The closed value sets of the domain, declared once.

Every enum column in the platform has a vocabulary, and that vocabulary is read
by three different things: the seed that writes the rows, the query builder that
offers the values to filter by, and the UI that colours them. When each keeps
its own copy they drift, and the drift is silent in the worst possible way — a
filter menu that simply never offers `IN_REVIEW` looks like a dataset with no
tasks in review, not like a bug.

So the names live here, the seed attaches weights to them (`seed/catalog.py`)
and the explorer attaches them to columns (`services/explorer.py`). Neither
spells a value out.

Order is significant: it is the order the seed's weights line up with, and the
order the values appear in a filter menu. Both read better as a lifecycle —
`NEW … DONE`, `PENDING … DELIVERED` — than alphabetically.
