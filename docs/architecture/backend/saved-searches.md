# Saved Data Explorer questions with owner-only mutation and SQL visibility

Saved Data Explorer questions with owner-only mutation and SQL visibility.

The service stores both the question and its presentation.  Read access is
resolved by one SQL predicate (owner, public, or explicit share); mutation is
always restricted to the owner, irrespective of visibility.
