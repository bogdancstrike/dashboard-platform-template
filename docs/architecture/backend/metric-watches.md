# Metric watches

Anomaly alerts (§22): watch a metric and notify on a spike or a drop.

**A watch is a question the explorer can already answer**, asked over time: a
dataset, a measure (a count of rows, or the sum or average of a number), the
same filter arguments a list's URL carries, and a granularity. The series is
one grouped `date_trunc` in PostgreSQL over the dataset's own declared date
field, with empty buckets filled as zero — a day nobody placed an order is a
day with no orders, not a gap.

**Detection is deliberately simple and explainable.**

* `zscore` judges each point against the mean and standard deviation of the
  `window` points before it.
* `seasonal` judges it against the *same slot* in earlier cycles — the same
  hour on previous days, the same weekday in previous weeks — which is what
  stops every Monday from being a spike in a weekly-shaped business.

Sensitivity is the z threshold (low 4, medium 3, high 2.2) unless a watch
sets one. A standard deviation is floored so a flat-zero baseline does not
make one stray row "infinitely" unusual. The bucket still in progress is only
ever judged for a *spike* — it can still grow, so it cannot yet be a drop.

**Every flagged point is kept** (`metric_anomalies`), with the window it was
judged against, so the alert page redraws the chart exactly as the detector
saw it. A snoozed or muted watch still records; it just does not tell anybody,
and says why.

**Notifications** go to the owner and the named recipients: in-app, and — when
the watch asks for it — an email written into the platform's mailbox outbox,
the same honest delivery automations use.
