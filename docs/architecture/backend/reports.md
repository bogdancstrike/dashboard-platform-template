# Saved reports (§28)

Saved reports (§28).

A report is a *saved analysis*: which dataset, grouped by what, measured how,
filtered how, over which period, drawn as what. Running one is not a second
query engine — it hands the stored definition to `services/analysis.py`, the
same compiler the analytics workspace and both builders use. A report that
computed its numbers differently from the screen it was built on would be a
report nobody could reconcile with the screen it was built on.

Sharing is `core/sharing`, exactly as saved searches use it: private by
default, shared with named members, public, and only the owner writes. The
requirement is explicit — one mechanism, one table, one set of rules — so
adopting it here costs a single string (`KIND`) rather than a second set of
visibility bugs.
