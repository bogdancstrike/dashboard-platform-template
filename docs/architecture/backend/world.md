# The dataset under construction, and how big it is

The dataset under construction, and how big it is.

Builders run in dependency order and hand each other rows through this object
rather than re-querying: a seed that reads back what it just wrote is a seed
that spends most of its time in the database, and referential consistency
becomes something you hope for rather than something you hold.
