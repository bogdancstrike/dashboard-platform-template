# Data quality — what is wrong with the records, and where to go and fix it (§65)

Data quality — what is wrong with the records, and where to go and fix it (§65).

Every dataset in a real installation rots in the same few ways: a customer
nobody owns, a ticket marked resolved with no moment of resolution, a device
that has not reported in a month, two accounts with one email address. None of
those is a bug in the software and all of them break something downstream — a
report, a rota, a bill — so a platform that cannot show them is a platform where
somebody finds out from a customer.

Three decisions carry this module, and the first is the one that makes it worth
having at all.

**A check is declared as the list's own filter, not as its own SQL.** Each
`Check` carries the same `filters` a reader could type into the URL bar, and
both the count and the *link* come from them — so "42 unassigned open tickets"
opens exactly the forty-two rows it counted, through `apply_filters` and
`core/query`'s operator vocabulary. A count nobody can open is a count nobody
can fix, and a count computed by one query and linked to another is a count
that will eventually disagree with its own list.

**The checks the filter vocabulary cannot express say so.** `spent > budget`
compares two columns, and the query language compares a column to a *value* —
by design, because a filter bar that could name a second column is a query
builder. Those checks carry a predicate instead, are counted in SQL like the
rest, and publish a *sample* of records rather than a list link. The page draws
the difference rather than hiding it: a link that quietly returned the wrong
rows would be worse than no link.

**Severity is about the data, not about the reader.** CRITICAL is a
*contradiction* — a state that cannot be true, like an order shipped and never
paid; WARNING is a gap somebody should close; INFO is a fact worth publishing
that nobody has to act on today. Graded that way rather than by count, because
one contradiction matters more than four hundred missing phone numbers.
