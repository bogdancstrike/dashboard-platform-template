# `src/core/graph`

Graph analysis over an in-memory edge list (§50).

The relationship explorer draws pictures of the record graph. A picture of a
few hundred nodes with no structure imposed on it is a hairball — pretty, and
unreadable. What makes it readable is **community structure**: the observation
that the records cluster, and that the clusters mean something (this customer,
their orders, their tickets, the people who work them).

So the clustering is computed here, on the server, and shipped with the graph:

* the browser draws what it is told rather than deciding what the data means;
* the answer is identical for every viewer, which a force simulation seeded by
  ``Math.random`` is not;
* and it is a pure function over an edge list, so it can be tested without a
  database, a browser or a screenshot.

The algorithm is **Louvain** (Blondel et al. 2008): greedily move each node
into whichever neighbouring community most improves modularity, then collapse
each community into one node and repeat. It needs no guess at the number of
clusters and it optimises the quantity the result is judged by.

Label propagation was tried first and rejected. It is simpler and faster, but
on a graph like this one — dense clusters joined by a handful of shared people
— one label reaches a bridge, wins a three-way tie, and avalanches until every
record is in one community. A clustering that always answers "one cluster" is
worse than none, because it looks like an answer.

Determinism matters as much as quality here: this drives a picture people
compare between reloads, and Louvain's usual random node order would redraw it
differently every time. Nodes are visited in sorted order and ties go to the
smallest community label, so one edge list always produces one answer.

Modularity is returned alongside because a partition without a quality number
invites the reader to believe whatever they are shown. Roughly: above 0.3 the
clustering is real, near 0 it is the structure of a random graph.
