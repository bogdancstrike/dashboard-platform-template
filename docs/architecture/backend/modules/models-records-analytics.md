# `src/models/records_analytics`

Records & analytics: customer health, contracts, metric watches, public links.

Four features share this module because they share a theme — reading the
records the platform already holds and saying something about them — and
because each owns only a handful of tables:

* **Customer health (§12).** A weighted model (`HealthModel`, one active row)
  turns tickets, orders, usage and renewal proximity into a 0–100 score.
  `CustomerHealth` is the *current* answer per customer, recomputed in bulk;
  `CustomerHealthSnapshot` is one row per customer per day, which is what the
  trend line and the portfolio's movers are drawn from.
* **Contracts (§13).** The customer renewals the design mentions, as records:
  value, term, owner, a pipeline stage and a probability. Their history is
  the audit trail (`resource_type = "contract"`), which is also what record
  version history reads — so a contract has versions the same way a ticket
  does, with no second ledger.
* **Metric watches (§22).** "Watch this number and tell me when it does
  something unusual": a dataset, a measure, filters and a granularity, a
  detection method and a sensitivity. `MetricAnomaly` is one flagged point,
  with the window it was judged against, so the alert page can redraw the
  chart exactly as the detector saw it.
* **Public dashboard links (§25).** A read-only token for one dashboard, with
  an optional password, an expiry, allowed embedding origins and a view count.

Record version history (§17) and the bulk-edit grid (§18) need no tables: the
first reads `audit_logs`, the second writes through the bulk API.
