# Relationships

How records connect (§44, §50).

The explorer answers questions about one dataset at a time. This answers the
question that follows the answer: *this ticket — who raised it, which customer,
which project, and what else is attached to that project?*

The connections are **derived from the schema, not declared here.** Every link
is a foreign key that already exists, so the map cannot fall behind the model:
adding a column with a `ForeignKey` makes the relationship appear, and removing
one makes it disappear. A hand-written adjacency list is a second description
of the database that is wrong the first time anybody migrates.

Two directions, because they answer different questions:

* **outbound** — what this record points at. One row each: a ticket has one
  customer.
* **inbound** — what points at this record. Many rows, so they are counted and
  sampled: a customer has three hundred orders, and the useful answer is "300,
  here are the newest ten".
